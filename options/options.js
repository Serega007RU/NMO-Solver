import { openDB } from '/libs/idb.js';

let db, settings, resolveInit
async function init() {
    // noinspection JSVoidFunctionReturnValueUsed
    const response = await chrome.runtime.sendMessage({status: true})
    if (response.initializing) {
        initializing(0)
        await new Promise(resolve => resolveInit = resolve)
    }
    db = await openDB('nmo', 12)
    self.db = db
    settings = await db.get('other', 'settings')
    self.settings = settings
    await restoreOptions()
    document.querySelector('.loading').style.display = 'none'
    document.querySelector('.main').removeAttribute('style')
    if (response.initializing) {
        alert('Расширение успешно прошёл инициализацию, можете открывать тесты')
    }
}
const initializeFunc = init()

document.addEventListener('DOMContentLoaded', async ()=> {
    await initializeFunc

    //Загрузка переключателей
    const nav_btns = document.querySelectorAll('nav button')
    const blocks = document.querySelectorAll('div.block')
    nav_btns.forEach((el)=> {
        el.addEventListener('click', () => {
            const mode = el.getAttribute('data-block')
            if (mode === 'auto') {
                el.textContent = 'В разработке'
                setTimeout(() => {
                    el.textContent = 'Автоматический'
                }, 3000)
                return
            }

            blocks.forEach((block) => {
                block.classList.remove('active')
                const dataBlock = block.getAttribute('data-block')
                if (dataBlock === el.getAttribute('data-block')) {
                    block.classList.add('active')
                }
            })

            nav_btns.forEach((btn)=> {
                btn.classList.remove('active')
            })
            el.classList.add('active')

            settings.mode = mode
            onChangedSettings()

            toggleContentScript()
            toggleVisibleScript()
            toggleRuleSet()
        })
    })

    const exportDbStatus = document.querySelector('#exportdb .status')
    let exporting = false
    document.querySelector('#exportdb').addEventListener('click', async () => {
        if (exporting) return
        exporting = true
        try {
            exportDbStatus.textContent = 'Экспортирование бд...'
            const questions = await db.getAllFromIndex('questions', 'newChange', IDBKeyRange.lowerBound(1))
            const topics = await db.getAllFromIndex('topics', 'newChange', IDBKeyRange.lowerBound(1))
            if (!questions.length) {
                exportDbStatus.innerText = 'Экспортировать нечего\nв вашей базе нет новых изменений'
                return
            }
            const text = JSON.stringify({questions, topics})
            const blob = new Blob([text],{type: 'text/json;charset=UTF-8;'})
            const anchor = document.createElement('a')

            anchor.download = 'nmo_db.json'
            anchor.href = (window.webkitURL || window.URL).createObjectURL(blob)
            anchor.dataset.downloadurl = ['text/json;charset=UTF-8;', anchor.download, anchor.href].join(':')
            anchor.click()
            exportDbStatus.textContent = 'Готово'
        } catch (error) {
            console.error(error)
            exportDbStatus.innerText = 'Произошла ошибка:\n' + error.message
        } finally {
            exporting = false
        }
    })

    const importDbStatus = document.querySelector('#importdb .status')
    let importing = false
    document.querySelector('#importdb').addEventListener('change', async (event) => {
        if (importing) return
        importing = true
        try {
            if (event.target.files.length === 0) return
            importDbStatus.innerText = 'Импортируем...'
            const [file] = event.target.files
            const data = await new Response(file).json()
            await joinQuestions(data, importDbStatus)
        } catch (error) {
            console.error(error)
            importDbStatus.innerText = 'Произошла ошибка:\n' + error.message
        } finally {
            document.querySelector('#importdb').value = ''
            importing = false
        }
    }, false)

    document.querySelector('#ClickWaitMin').addEventListener('input', (event) => {
        if (event.target.valueAsNumber !== undefined) {
            settings.clickWaitMin = event.target.valueAsNumber * 1000
            document.querySelector('#ClickWaitMax').min = event.target.valueAsNumber
            onChangedSettings()
        }
    })
    document.querySelector('#ClickWaitMax').addEventListener('input', (event) => {
        if (event.target.valueAsNumber !== undefined) {
            settings.clickWaitMax = event.target.valueAsNumber * 1000
            document.querySelector('#ClickWaitMin').max = event.target.valueAsNumber
            onChangedSettings()
            toggleVisibleScript()
        }
    })
    document.querySelector('#AnswerWaitMin').addEventListener('input', (event) => {
        if (event.target.valueAsNumber !== undefined) {
            settings.answerWaitMin = event.target.valueAsNumber * 1000
            document.querySelector('#AnswerWaitMax').min = event.target.valueAsNumber
            onChangedSettings()
        }
    })
    document.querySelector('#AnswerWaitMax').addEventListener('input', (event) => {
        if (event.target.valueAsNumber !== undefined) {
            settings.answerWaitMax = event.target.valueAsNumber * 1000
            document.querySelector('#AnswerWaitMin').max = event.target.valueAsNumber
            onChangedSettings()
            toggleVisibleScript()
        }
    })
    document.querySelector('#MaxAttemptsNext').addEventListener('input',  (event) => {
        if (event.target.valueAsNumber !== undefined) {
            settings.maxAttemptsNext = event.target.valueAsNumber
            onChangedSettings()
        }
    })
    document.querySelector('#MaxReloadTab').addEventListener('input', (event) => {
        if (event.target.valueAsNumber !== undefined) {
            settings.maxReloadTab = event.target.valueAsNumber
            onChangedSettings()
        }
    })
    document.querySelector('#MaxReloadTest').addEventListener('input', (event) => {
        if (event.target.valueAsNumber !== undefined) {
            settings.maxReloadTest = event.target.valueAsNumber
            onChangedSettings()
        }
    })
})

async function restoreOptions() {
    const nav_btns = document.querySelectorAll('nav button')
    const blocks = document.querySelectorAll('div.block')
    blocks.forEach((block) => {
        block.classList.remove('active')
        const dataBlock = block.getAttribute('data-block')
        if (dataBlock === settings.mode) {
            block.classList.add('active')
        }
    })
    nav_btns.forEach((btn)=> {
        btn.classList.remove('active')
    })
    document.querySelector('nav button[data-block="' + settings.mode + '"]').classList.add('active')

    document.querySelector('#ClickWaitMin').value = settings.clickWaitMin / 1000
    document.querySelector('#ClickWaitMin').max = settings.clickWaitMax / 1000
    document.querySelector('#ClickWaitMax').value = settings.clickWaitMax / 1000
    document.querySelector('#ClickWaitMax').min = settings.clickWaitMin / 1000
    document.querySelector('#AnswerWaitMin').value = settings.answerWaitMin / 1000
    document.querySelector('#AnswerWaitMin').max = settings.answerWaitMax / 1000
    document.querySelector('#AnswerWaitMax').value = settings.answerWaitMax / 1000
    document.querySelector('#AnswerWaitMax').min = settings.answerWaitMin / 1000
    document.querySelector('#MaxAttemptsNext').value = settings.maxAttemptsNext
    document.querySelector('#MaxReloadTab').value = settings.maxReloadTab
    document.querySelector('#MaxReloadTest').value = settings.maxReloadTest

    const newAnswers = await db.countFromIndex('questions', 'newChange', 2)
    const newChanges = await db.countFromIndex('questions', 'newChange', 1)
    const newTopics = await db.countFromIndex('topics', 'newChange', 1)
    document.querySelector('label[for="exportdb"] .status').innerText = `Кол-во изменений в вашей бд:\nНовых ответов ${newAnswers}\nНовых изменений ${newChanges}\nНовых тем ${newTopics}`
}

chrome.runtime.onMessage.addListener((message) => {
    if (message.initializing !== null) {
        if (message.initializing === '100.0') {
            if (resolveInit) resolveInit()
        } else {
            initializing(message.initializing)
        }
    }
})

function initializing(percent) {
    let text = 'Идёт инициализация\nлокальной базы данных расширения\nпожалуйста подождите\nэто может занять около 5-ти минут\n\n'
    if (percent) text += 'загружено ' + percent + '%'
    document.querySelector('#LoadingText').innerText = text
}

async function onChangedSettings() {
    await db.put('other', settings, 'settings')
    chrome.runtime.sendMessage({reloadSettings: true})
    const tabs = await chrome.tabs.query({url: 'https://*.edu.rosminzdrav.ru/*'})
    for (const tab of tabs) {
        try {
            await chrome.tabs.sendMessage(tab.id, {status: true, settings})
        } catch (ignored) {}
    }
}

async function joinQuestions(json, status) {
    console.log('Объединение баз данных запущено')
    const transaction = db.transaction(['questions', 'topics'], 'readwrite')
    const oldTopics = {}

    let length = json.topics.length + json.questions.length
    let currentLength = 0
    const oldNewAnswers = await transaction.objectStore('questions').index('newChange').count(2)
    const oldNewChanges = await transaction.objectStore('questions').index('newChange').count(1)
    const oldNewTopics = await transaction.objectStore('topics').index('newChange').count(1)

    for (const newTopic of json.topics) {
        oldTopics[newTopic.key] = newTopic.name
        const count = await transaction.objectStore('topics').index('name').count(newTopic.name)
        if (!count) {
            delete newTopic.key
            newTopic.newChange = 1
            await transaction.objectStore('topics').put(newTopic)
        }
        currentLength++
        status.innerText = `Объединяем бд\nПрогресс ${currentLength} / ${length}`
    }

    for (const newQuestion of json.questions) {
        const key = await transaction.objectStore('questions').index('question').getKey(newQuestion.question)
        if (!key) {
            for (const [index, oldTopicKey] of newQuestion.topics.entries()) {
                const topicKey = await transaction.objectStore('topics').index('name').getKey(oldTopics[oldTopicKey])
                if (topicKey == null) {
                    console.warn('Проблема при объединении баз данных, не найдена тема', oldTopicKey)
                    continue
                }
                newQuestion.topics[index] = topicKey
            }
            newQuestion.newChange = 1
            if (Object.keys(newQuestion.correctAnswers).length) newQuestion.newChange = 2
            console.log('добавлен', newQuestion)
            await transaction.objectStore('questions').add(newQuestion)
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
                if (changedAnswers) question.newChange = 2
                if (changed) question.newChange = 1
                console.log('обновлён', question)
                await transaction.objectStore('questions').put(question, key)
            }
        }
        currentLength++
        status.innerText = `Объединяем бд\nПрогресс ${currentLength} / ${length}`
    }
    const newAnswers = await transaction.objectStore('questions').index('newChange').count(2)
    const newChanges = await transaction.objectStore('questions').index('newChange').count(1)
    const newTopics = await transaction.objectStore('topics').index('newChange').count(1)
    status.innerText = `Объединение завершено\nВ БД добавлено\n${oldNewAnswers - newAnswers} новых ответов\n${oldNewChanges - newChanges} новых изменений\n${oldNewTopics - newTopics} новых тем`
    console.log('Объединение баз данных окончено')
}

