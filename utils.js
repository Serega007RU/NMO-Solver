async function toggleVisibleScript() {
    const scripts = await chrome.scripting.getRegisteredContentScripts({ids: ['visible-script']})
    if ((settings.mode === 'semi-auto' || settings.mode === 'auto') && settings.answerWaitMax <= 500 && settings.clickWaitMax <= 500) {
        if (!scripts.length) {
            await chrome.scripting.registerContentScripts([{
                id: 'visible-script',
                js: ['content-scripts/visible.js'],
                matches: ['https://*.edu.rosminzdrav.ru/quiz-wrapper/*'],
                world: 'MAIN',
                runAt: 'document_start'
            }])
        }
    } else {
        if (scripts.length) {
            await chrome.scripting.unregisterContentScripts({ids: ['visible-script']})
        }
    }
}
self.toggleVisibleScript = toggleVisibleScript

async function toggleContentScript() {
    const scripts = await chrome.scripting.getRegisteredContentScripts({ids: ['content-script']})
    if (settings.mode !== 'disabled') {
        if (!scripts.length) {
            await chrome.scripting.registerContentScripts([{
                id: 'content-script',
                js: ['normalize-text.js', 'content-scripts/content-script.js'],
                matches: ['https://*.edu.rosminzdrav.ru/*']
            }])
            if (self.window) {
                const tabs = await chrome.tabs.query({url: 'https://*.edu.rosminzdrav.ru/*'})
                for (const tab of tabs) {
                    if (tab.status === 'complete') {
                        chrome.scripting.executeScript({files: ['normalize-text.js', 'content-scripts/content-script.js'], target: {tabId: tab.id}})
                    }
                }
            }
        }
    } else {
        if (scripts.length) {
            await chrome.scripting.unregisterContentScripts({ids: ['content-script']})
            if (self.window) {
                const tabs = await chrome.tabs.query({url: 'https://*.edu.rosminzdrav.ru/*'})
                for (const tab of tabs) {
                    if (tab.status === 'complete') {
                        chrome.tabs.reload(tab.id)
                    }
                }
            }
        }
    }
}
self.toggleContentScript = toggleContentScript

async function toggleRuleSet() {
    const rules = await chrome.declarativeNetRequest.getEnabledRulesets()
    if (settings.mode === 'manual' || settings.mode === 'disabled') {
        if (rules.length && !self.window) {
            await chrome.declarativeNetRequest.updateEnabledRulesets({disableRulesetIds: ['ruleset_1']})
        }
    } else {
        if (!rules.length) {
            await chrome.declarativeNetRequest.updateEnabledRulesets({enableRulesetIds: ['ruleset_1']})
        }
    }
}
self.toggleRuleSet = toggleRuleSet

async function joinDB(json, transaction, status) {
    console.log('Объединение баз данных запущено')
    const oldTopics = {}

    let length, currentLength, oldNewAnswers, oldNewChangesQuestions, oldNewChangesTopics, oldNewChanges, oldNewTopics
    if (status) {
        length = json.topics.length + json.questions.length
        currentLength = 0
        oldNewAnswers = await transaction.objectStore('questions').index('newChange').count(2)
        oldNewChangesQuestions = await transaction.objectStore('questions').index('newChange').count(1)
        oldNewChangesTopics = await transaction.objectStore('topics').index('newChange').count(2)
        oldNewChanges = oldNewChangesQuestions + oldNewChangesTopics
        oldNewTopics = await transaction.objectStore('topics').index('newChange').count(1)
    }

    for (const newTopic of json.topics) {
        if (!newTopic.name) {
            if (status) {
                currentLength++
                status.innerText = `Объединяем бд\nПрогресс ${currentLength} / ${length}`
            } else {
                self.initStage.stage2.current++
                self.initStage.stage3.current++
                sendStage()
            }
            continue
        }
        oldTopics[newTopic.key] = newTopic.name
        let found
        if (newTopic.id) {
            found = await transaction.objectStore('topics').index('id').get(newTopic.id)
        }
        if (!found && newTopic.code) {
            found = await transaction.objectStore('topics').index('code').get(newTopic.code)
        }
        if (!found && newTopic.name) {
            found = await transaction.objectStore('topics').index('name').get(newTopic.name)
        }
        if (!found) {
            delete newTopic.key
            if (status) {
                newTopic.newChange = 1
            } else {
                delete newTopic.newChange
            }
            await transaction.objectStore('topics').put(newTopic)
            // console.debug('добавлена тема', newTopic)
        } else {
            let changed = false
            if (!found.code && newTopic.code) {
                found.code = newTopic.code
                changed = true
            }
            if (!found.id && newTopic.id) {
                found.id = newTopic.id
                changed = true
            }
            if (!found.name && newTopic.name) {
                found.name = newTopic.name
                changed = true
            }
            if (changed) {
                if (status) {
                    if (!found.newChange) found.newChange = 2
                } else {
                    delete found.newChange
                }
                await transaction.objectStore('topics').put(found)
                // console.debug('обновлена тема', found)
            } else if (!status) {
                delete found.newChange
                await transaction.objectStore('topics').put(found)
            }
        }
        if (status) {
            currentLength++
            status.innerText = `Объединяем бд\nПрогресс ${currentLength} / ${length}`
        } else {
            self.initStage.stage2.current++
            self.initStage.stage3.current++
            sendStage()
        }
    }

    for (const newQuestion of json.questions) {
        const key = await transaction.objectStore('questions').index('question').getKey(newQuestion.question)
        if (!key) {
            for (const [index, oldTopicKey] of newQuestion.topics.entries()) {
                if (!oldTopics[oldTopicKey]) {
                    continue
                }
                const topicKey = await transaction.objectStore('topics').index('name').getKey(oldTopics[oldTopicKey])
                if (topicKey == null) {
                    console.warn('Проблема при объединении баз данных, не найдена тема', oldTopicKey)
                    continue
                }
                newQuestion.topics[index] = topicKey
            }
            if (status) {
                newQuestion.newChange = 1
                if (Object.keys(newQuestion.correctAnswers).length) newQuestion.newChange = 2
            } else {
                delete newQuestion.newChange
            }
            await transaction.objectStore('questions').add(newQuestion)
            // console.debug('добавлен вопрос', newQuestion)
        } else {
            let question = await transaction.objectStore('questions').get(key)
            let changedAnswers, changed = false
            for (const answersHash of Object.keys(newQuestion.answers)) {
                if (!question.answers[answersHash] || (!question.answers[answersHash].type && newQuestion.answers[answersHash].type)) {
                    changed = true
                    question.answers[answersHash] = newQuestion.answers[answersHash]
                }
                if (!question.correctAnswers[answersHash] && newQuestion.correctAnswers[answersHash]) {
                    changedAnswers = true
                    question.correctAnswers[answersHash] = newQuestion.correctAnswers[answersHash]
                }
            }

            if (newQuestion.answers['unknown']) {
                if (question.answers['unknown'] == null) question.answers['unknown'] = []
                for (const answer of newQuestion.answers['unknown']) {
                    if (!question.answers['unknown'].includes(answer)) {
                        changed = true
                        question.answers['unknown'].push(answer)
                    }
                }
            }
            if (newQuestion.correctAnswers['unknown']) {
                if (question.correctAnswers['unknown'] == null) question.correctAnswers['unknown'] = []
                for (const answer of newQuestion.correctAnswers['unknown']) {
                    if (!question.correctAnswers['unknown'].includes(answer)) {
                        changedAnswers = true
                        question.correctAnswers['unknown'].push(answer)
                    }
                }
            }

            const topics = []
            for (const topicKey of question.topics) {
                const topic = await transaction.objectStore('topics').get(topicKey)
                if (topic == null) {
                    console.warn('Проблема при объединении баз данных, не найдена тема', topicKey)
                    continue
                }
                topics.push(topic.name)
            }
            for (const topicKey of newQuestion.topics) {
                if (oldTopics[topicKey] && !topics.includes(oldTopics[topicKey])) {
                    const newTopicKey = await transaction.objectStore('topics').index('name').getKey(oldTopics[topicKey])
                    if (newTopicKey == null) {
                        console.warn('Проблема при объединении баз данных, не найдена тема', oldTopics[topicKey], topicKey)
                        continue
                    }
                    changed = true
                    question.topics.push(newTopicKey)
                }
            }

            if (changed || changedAnswers) {
                if (status) {
                    if (changed && !question.newChange) question.newChange = 1
                    if (changedAnswers) question.newChange = 2
                } else {
                    delete question.newChange
                }
                await transaction.objectStore('questions').put(question, key)
                // console.debug('обновлён вопрос', newQuestion)
            } else if (!status) {
                delete question.newChange
                await transaction.objectStore('questions').put(question, key)
            }
        }
        if (status) {
            currentLength++
            status.innerText = `Объединяем бд\nПрогресс ${currentLength} / ${length}`
        } else {
            self.initStage.stage2.current++
            self.initStage.stage3.current++
            sendStage()
        }
    }

    if (status) {
        const newAnswers = await transaction.objectStore('questions').index('newChange').count(2)
        const newChangesQuestions = await transaction.objectStore('questions').index('newChange').count(1)
        const newChangesTopics = await transaction.objectStore('topics').index('newChange').count(2)
        const newChanges = newChangesQuestions + newChangesTopics
        const newTopics = await transaction.objectStore('topics').index('newChange').count(1)
        status.innerText = `Объединение завершено\nВ БД добавлено\n${newAnswers - oldNewAnswers} новых ответов\n${newChanges - oldNewChanges} новых изменений\n${newTopics - oldNewTopics} новых тем`
        await updateStats()
    }

    console.log('Объединение баз данных окончено')
}
self.joinDB = joinDB
