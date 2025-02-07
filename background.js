import { openDB } from '/libs/idb.js';
import { default as objectHash } from '/libs/object-hash.js';
import '/utils.js'
import '/normalize-text.js'

let db
let runningTab
let rejectWait
let stopRunning = false
let controller = new AbortController()
let reloadTabTimer
let lastResetReloadTabTimer
let collectAnswers = 0
let reloaded = 0
let started = 0
let startFunc
let settings
// let tempCabinet
let lastScore

class TopicError extends Error {}

const dbVersion = 17
const initializeFunc = init()
waitUntil(initializeFunc)
initializeFunc.finally(() => initializeFunc.done = true)
async function init() {
    db = await openDB('nmo', dbVersion, {upgrade})
    self.db = db
    async function upgrade(db, oldVersion, newVersion, transaction) {
        if (oldVersion !== newVersion) {
            console.log('Обновление базы данных с версии ' + oldVersion + ' на ' + newVersion)
        }

        if (oldVersion === 0) {
            const questions = db.createObjectStore('questions', {autoIncrement: true, keyPath: '_id'})
            questions.createIndex('question', 'question', {unique: true})
            questions.createIndex('topics', 'topics', {multiEntry: true})
            const topics = db.createObjectStore('topics', {autoIncrement: true, keyPath: '_id'})
            topics.createIndex('name', 'name')
            // 0 - не выполнено, 1 - выполнено, 2 - есть ошибки
            topics.createIndex('completed', 'completed')
            // 1 - эта тема внесена вручную пользователем
            topics.createIndex('dirty', 'dirty')
            topics.createIndex('inputIndex', 'inputIndex')
            topics.createIndex('completed, inputIndex', ['completed', 'inputIndex'])
            topics.createIndex('code', 'code', {unique: true})
            topics.createIndex('id', 'id', {unique: true})
            const other = db.createObjectStore('other')

            await other.put({
                mode: 'manual',
                clickWaitMin: 500,
                clickWaitMax: 2000,
                answerWaitMin: 3000,
                answerWaitMax: 10000,
                maxAttemptsNext: 16,
                maxReloadTab: 7,
                maxReloadTest: 30,
                goodScore: false,
                selectionMethod: true,
                timeoutReloadTabMin: 15000,
                timeoutReloadTabMax: 90000,
                offlineMode: false,
                sendResults: true
            }, 'settings')
            return
        }

        if (oldVersion <= 12) {
            console.log('Этап обновления с версии 12 на 13')
            settings = await transaction.objectStore('other').get('settings')
            settings.timeoutReloadTabMin = 15000
            settings.timeoutReloadTabMax = 90000
            await transaction.objectStore('other').put(settings, 'settings')
        }

        if (oldVersion <= 14) {
            await db.deleteObjectStore('questions')
            await db.deleteObjectStore('topics')
            const questions = db.createObjectStore('questions', {autoIncrement: true, keyPath: '_id'})
            questions.createIndex('question', 'question', {unique: true})
            questions.createIndex('topics', 'topics', {multiEntry: true})
            const topics = db.createObjectStore('topics', {autoIncrement: true, keyPath: '_id'})
            topics.createIndex('name', 'name')
            topics.createIndex('completed', 'completed')
            topics.createIndex('code', 'code', {unique: true})
            topics.createIndex('id', 'id', {unique: true})
        }

        if (oldVersion <= 15) {
            transaction.objectStore('topics').createIndex('dirty', 'dirty')
            transaction.objectStore('topics').createIndex('inputIndex', 'inputIndex')
            transaction.objectStore('topics').createIndex('completed, inputIndex', ['completed', 'inputIndex'])
            settings = await transaction.objectStore('other').get('settings')
            settings.selectionMethod = true
            settings.offlineMode = false
            settings.goodScore = false
            await transaction.objectStore('other').put(settings, 'settings')
        }

        if (oldVersion <= 16) {
            settings = await transaction.objectStore('other').get('settings')
            settings.sendResults = true
            await transaction.objectStore('other').put(settings, 'settings')
        }

        console.log('Обновление базы данных завершено')
    }


    settings = await db.get('other', 'settings')
    self.settings = settings

    await toggleContentScript()
    await toggleVisibleScript()
    await toggleRuleSet()

    console.log('started background!')
}

// chrome.runtime.onInstalled.addListener(function(details) {
//     if (details.reason === 'install') {
//         chrome.runtime.openOptionsPage()
//     }
// })

self.resetOptionalVariables = resetOptionalVariables
async function resetOptionalVariables() {
    const transaction = db.transaction(['questions', 'topics'], 'readwrite')

    for await (const cursor of transaction.objectStore('questions')) {
        const question = cursor.value
        let changed
        if (question.lastOrder) {
            changed = true
            delete question.lastOrder
        }
        for (const answersHash of Object.keys(question.answers)) {
            if (question.answers[answersHash].fakeCorrectAnswers) {
                changed = true
                delete question.answers[answersHash].fakeCorrectAnswers
            }
            if (question.answers[answersHash].tryedAI) {
                changed = true
                delete question.answers[answersHash].tryedAI
            }
            if (question.answers[answersHash].lastUsedAnswers) {
                changed = true
                delete question.answers[answersHash].lastUsedAnswers
            }
            if (question.answers[answersHash].combinations) {
                changed = true
                delete question.answers[answersHash].combinations
            }
        }
        if (changed) {
            await cursor.update(question)
        }
    }

    for await (const cursor of transaction.objectStore('topics')) {
        const topic = cursor.value
        let changed
        if (topic.inputName) {
            changed = true
            delete topic.inputName
        }
        if (topic.inputIndex != null) {
            changed = true
            delete topic.inputIndex
        }
        if (topic.completed != null) {
            changed = true
            delete topic.completed
        }
        if (topic.needSearchAnswers != null) {
            changed = true
            delete topic.needSearchAnswers
        }
        if (topic.dirty != null) {
            changed = true
            delete topic.dirty
        }
        if (topic.error) {
            changed = true
            delete topic.error
        }
        if (changed) {
            await cursor.update(topic)
        }
    }
}

self.fixDupQuestions = fixDupQuestions
async function fixDupQuestions() {
    let transaction
    try {
        transaction = db.transaction('questions', 'readwrite')

        {
            console.log('этап 1')
            let cursor = await transaction.store.openCursor()
            while (cursor) {
                const question = cursor.value

                const newQuestion = normalizeText(question.question)
                if (question.question !== newQuestion) {
                    console.log('Исправлено название', question)
                    question.question = newQuestion
                }

                for (const answerHash of Object.keys(question.answers)) {
                    const newAnswers = []
                    for (const answer of question.answers[answerHash].answers) {
                        newAnswers.push(normalizeText(answer))
                    }
                    newAnswers.sort()
                    const newAnswer = question.answers[answerHash]
                    const newAnswerHash = objectHash(newAnswers)

                    const oldQuestion = JSON.stringify(question)
                    delete question.answers[answerHash]
                    // TODO мы удаляем комбинации так как меняется сортировка вопросов из-за разного регистра букв
                    delete newAnswer.combinations
                    if (question.answers[newAnswerHash]) {
                        console.warn('Найдены дублирующиеся ответы', oldQuestion, question)
                    }

                    newAnswer.answers = newAnswers
                    question.answers[newAnswerHash] = newAnswer

                    if (question.correctAnswers[answerHash]) {
                        const newCorrectAnswers = []
                        for (const answer of question.correctAnswers[answerHash]) {
                            newCorrectAnswers.push(normalizeText(answer))
                        }
                        newCorrectAnswers.sort()
                        delete question.correctAnswers[answerHash]
                        question.correctAnswers[newAnswerHash] = newCorrectAnswers
                    }
                }

                await cursor.update(question)

                // noinspection JSVoidFunctionReturnValueUsed
                cursor = await cursor.continue()
            }
        }

        {
            console.log('этап 2')
            let cursor = await transaction.store.openCursor()
            while (cursor) {
                const count = await transaction.store.index('question').count(cursor.value.question)
                if (count > 1) {
                    console.warn('Найден дубликат', cursor.value)
                    let cursor2 = await transaction.store.index('question').openCursor(cursor.value.question)
                    const question = cursor2.value
                    // noinspection JSVoidFunctionReturnValueUsed
                    cursor2 = await cursor2.continue()
                    let changed = false
                    while (cursor2) {
                        for (const answersHash of Object.keys(cursor2.value.answers)) {
                            if (!question.answers[answersHash] || (!question.answers[answersHash].type && cursor2.value.answers[answersHash].type)) {
                                changed = true
                                question.answers[answersHash] = cursor2.value.answers[answersHash]
                            }
                            if (!question.correctAnswers[answersHash] && cursor2.value.correctAnswers[answersHash]) {
                                changed = true
                                question.correctAnswers[answersHash] = cursor2.value.correctAnswers[answersHash]
                            }
                        }

                        if (cursor2.value.answers['unknown']) {
                            if (question.answers['unknown'] == null) question.answers['unknown'] = []
                            for (const answer of cursor2.value.answers['unknown']) {
                                if (!question.answers['unknown'].includes(answer)) {
                                    changed = true
                                    question.answers['unknown'].push(answer)
                                }
                            }
                        }
                        if (cursor2.value.correctAnswers['unknown']) {
                            if (question.correctAnswers['unknown'] == null) question.correctAnswers['unknown'] = []
                            for (const answer of cursor2.value.correctAnswers['unknown']) {
                                if (!question.correctAnswers['unknown'].includes(answer)) {
                                    changed = true
                                    question.correctAnswers['unknown'].push(answer)
                                }
                            }
                        }

                        for (const topic of cursor2.value.topics) {
                            if (!question.topics.includes(topic)) {
                                changed = true
                                question.topics.push(topic)
                            }
                        }

                        // console.warn('Удалено', cursor2.value)
                        await cursor2.delete()

                        // noinspection JSVoidFunctionReturnValueUsed
                        cursor2 = await cursor2.continue()
                    }
                    if (changed) {
                        console.warn('Дубликат объединён в', question)
                        await cursor.update(question)
                    }
                }
                // noinspection JSVoidFunctionReturnValueUsed
                cursor = await cursor.continue()
            }
        }
    } catch (error) {
        transaction.abort()
        console.error(error)
    }
}

self.fixDupTopics = fixDupTopics
async function fixDupTopics() {
    let transaction
    try {
        transaction = db.transaction(['questions', 'topics'], 'readwrite')
        let cursor = await transaction.objectStore('topics').openCursor()
        while (cursor) {
            const topic = cursor.value
            if (!topic.name) {
                console.warn('нет имени!', topic)
                // noinspection JSVoidFunctionReturnValueUsed
                cursor = await cursor.continue()
                continue
            }
            const newName = normalizeText(topic.name)
            const found = await transaction.objectStore('topics').index('name').get(newName)
            if (found && found._id !== topic._id) {
                console.warn('Найден дублирующий topic, он был удалён и объединён', found)
                await transaction.objectStore('topics').delete(found._id)
                if (topic.id !== found.id) {
                    topic.id = found.id
                }
                if (topic.name !== found.name) {
                    topic.name = normalizeText(found.name)
                } else if (topic.name) {
                    topic.name = normalizeText(topic.name)
                }
                if (topic.code !== found.number) {
                    topic.code = found.number
                }
                await cursor.update(topic)

                let cursor2 = await transaction.objectStore('questions').index('topics').openCursor(found._id)
                while (cursor2) {
                    const question = cursor2.value
                    question.topics.splice(question.topics.indexOf(found._id), 1)
                    if (!question.topics.includes(topic._id)) question.topics.push(topic._id)
                    await cursor2.update(question)
                    // noinspection JSVoidFunctionReturnValueUsed
                    cursor2 = await cursor2.continue()
                }
            } else if (topic.name !== newName) {
                console.warn('Исправлено название', topic)
                topic.name = newName
                await cursor.update(topic)
            }
            // noinspection JSVoidFunctionReturnValueUsed
            cursor = await cursor.continue()
        }
    } catch (error) {
        transaction.abort()
        console.error(error)
    }
}

self.getCorrectAnswers = getCorrectAnswers
async function getCorrectAnswers(topic, index) {
    topic = topic.toLowerCase()
    let searchCursor = await db.transaction('topics').store.index('name').openCursor(IDBKeyRange.bound(topic, topic + '\uffff'))
    if (!searchCursor) throw Error('Не найдено')
    let currIndex = 0
    let result
    while (searchCursor) {
        result = searchCursor
        currIndex++
        if (index == null || currIndex === index) {
            console.log(currIndex, searchCursor.value.name)
        }
        if (currIndex === index) break
        // noinspection JSVoidFunctionReturnValueUsed
        searchCursor = await searchCursor.continue()
    }
    if (currIndex > 1 && index == null) {
        console.log('По заданному названию найдено несколько тем, в качестве второго аргумента данной функции укажите номер из предложенных вариантов')
        return
    }
    if (!result) throw Error('Не найдено по заданному номеру')
    // console.log('Поиск...')
    let text = result.value.name + ':\n\n'
    let cursor = await db.transaction('questions').store.index('topics').openCursor(result.value._id)
    while(cursor) {
        const question = cursor.value
        for (const answerHash of Object.keys(question.answers)) {
            if (question.correctAnswers[answerHash]) {
                text += question.question + ':\n'
                for (const answer of question.correctAnswers[answerHash]) {
                    text += '+ ' + answer + '\n'
                }
                for (const answer of question.answers[answerHash].answers) {
                    if (!question.correctAnswers[answerHash].includes(answer)) {
                        text += '- ' + answer + '\n'
                    }
                }
                text += '\n'
            }
        }
        // noinspection JSVoidFunctionReturnValueUsed
        cursor = await cursor.continue()
    }
    return text
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.authData) {
        (async () => {
            await initializeFunc
            await db.put('other', message.authData, 'authData')
            if (!message.cabinet) message.cabinet = 'vo'
            message.cabinet = 'nmfo-' + message.cabinet
            await db.put('other', message.cabinet, 'cabinet')
        })()
    }
    if (message.status) {
        (async () => {
            await initializeFunc
            sendResponse({running: runningTab === sender.tab.id, collectAnswers, settings, lastScore})
        })()
        return true
    } else if (message.reloadPage) {
        if (message.error) {
            (async () => {
                await initializeFunc
                console.warn('Похоже на вкладке где решается тест что-то зависло, сделана перезагрузка вкладки', message.error)
                reloaded++
                if (reloaded >= settings.maxReloadTab) {
                    startFunc = start(runningTab, true, false, true)
                    startFunc.finally(() => startFunc.done = true)
                    showNotification('Предупреждение', 'Слишком много попыток перезагрузить страницу')
                } else {
                    chrome.tabs.reload(sender.tab.id)
                }
            })()
        } else {
            chrome.tabs.reload(sender.tab.id)
        }
        setReloadTabTimer()
    } else if (message.reloadSettings) {
        (async () => {
            await initializeFunc
            settings = await db.get('other', 'settings')
            self.settings = settings
        })()
    }
})

chrome.action.onClicked.addListener(async (tab) => {
    chrome.action.setTitle({title: chrome.runtime.getManifest().action.default_title})
    chrome.action.setBadgeText({text: ''})
    await initializeFunc
    if (settings.mode === 'manual' || settings.mode === 'disabled') {
        chrome.runtime.openOptionsPage()
        return
    }
    if (runningTab || (startFunc && !startFunc.done)) {
        console.warn('Работа расширения остановлена по запросу пользователя')
        if (runningTab) chrome.tabs.sendMessage(runningTab, {stop: true})
        stop()
    } else {
        let response
        try {
            response = await chrome.tabs.sendMessage(tab.id, {hasTest: true})
            if (!response) throw Error('Receiving end does not exist')
        } catch (error) {
            if (error.message.includes('Receiving end does not exist') || error.message.includes('message port closed before a response was received')) {
                showNotification('Ошибка', 'Похоже на данной вкладке открыт НЕ портал НМО (или что-то не относящееся к тестам ОИМ), если это не так - попробуйте обновить страницу')
            } else {
                showNotification('S Непредвиденная ошибка', error.message)
            }
            return
        }
        startFunc = start(tab.id, response.hasTest)
        startFunc.finally(() => startFunc.done = true)
    }
})

async function start(tabId, hasTest, done, hasError) {
    reloaded = 0
    lastScore = null
    clearTimeout(reloadTabTimer)
    if (done) {
        started = 0
    } else {
        started++
    }
    if (started >= settings.maxReloadTest) {
        showNotification('Ошибка', 'Слишком много попыток запустить тест')
        chrome.action.setBadgeText({text: 'ERR'})
        stop(false)
        return
    }
    waitUntilState(true)
    controller = new AbortController()
    stopRunning = false
    let url = await checkOrGetTopic()
    if (url === 'error') {
        waitUntilState(false)
        started = 0
        if (stopRunning) return
        chrome.action.setBadgeText({text: 'ERR'})
        stop(false)
        return
    }
    if (url === 'null') {
        if (done) {
            showNotification('Готово', 'Расширение окончил работу')
            chrome.action.setTitle({title: chrome.runtime.getManifest().action.default_title})
            chrome.action.setBadgeText({text: 'DONE'})
            stop(false)
            return
        } else if (!hasTest) {
            chrome.action.setTitle({title: chrome.runtime.getManifest().action.default_title})
            showNotification('Ошибка', 'На данной странице нет теста или не назначены тесты в настройках')
            chrome.action.setBadgeText({text: 'ERR'})
            stop(false)
            return
        } else if (hasError) {
            chrome.tabs.reload(tabId)
        } else {
            chrome.tabs.sendMessage(tabId, {start: true})
        }
    } else {
        await chrome.tabs.update(tabId, {url})
    }
    chrome.action.setTitle({title: 'Расширение решает тест'})
    chrome.action.setBadgeText({text: 'ON'})
    runningTab = tabId
    setReloadTabTimer()
}

async function checkOrGetTopic() {
    if (settings.mode !== 'auto') return 'null'
    const countEE = await db.countFromIndex('topics', 'completed, inputIndex', IDBKeyRange.bound([0, 0], [0, Infinity]))
    if (countEE) {
        chrome.action.setTitle({title: 'Выполняется поиск темы'})
        chrome.action.setBadgeText({text: 'SEARCH'})
        if (!(await db.get('other', 'authData'))?.access_token) {
            showNotification('Ошибка', 'Нет данных об авторизации')
            return 'error'
        }
        let url
        let count = 0
        while (true) {
            count++
            if (count >= 100) {
                showNotification('Ошибка', 'Слишком много попыток поиска темы')
                return 'error'
            }
            const educationalElement = await db.getFromIndex('topics', 'completed, inputIndex', IDBKeyRange.bound([0, 0], [0, Infinity]))
            if (!educationalElement) return 'null'
            try {
                url = await searchEducationalElement(educationalElement)
                break
            } catch (error) {
                if (stopRunning) return 'error'
                console.warn(error)
                if (error instanceof TopicError) {
                    if (error.message === 'Уже пройдено') {
                        educationalElement.completed = 1
                    } else {
                        educationalElement.error = error.message
                        educationalElement.completed = 2
                    }
                    await db.put('topics', educationalElement)
                    if (educationalElement.inputIndex != null) {
                        chrome.runtime.sendMessage({updatedTopic: educationalElement}, function () {
                            const lastError = chrome.runtime.lastError?.message
                            if (!lastError.includes('Receiving end does not exist') && !lastError.includes('message port closed before a response was received')) {
                                console.error(lastError)
                            }
                        })
                    }
                    continue
                } else if (
                    !error.message.startsWith('bad code 5') &&
                    !error.message.startsWith('Не была получена ссылка по теме ') &&
                    error.message !== 'Updated token' &&
                    error.message !== 'signal timed out' &&
                    error.message !== 'Failed to fetch' &&
                    error.message !== 'notFound'
                ) {
                    showNotification('W Непредвиденная ошибка', error.message)
                    return 'error'
                }
                await wait(Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin)
            }
        }
        return url
    }
    return 'null'
}

async function searchEducationalElement(educationalElement, cut, inputName) {
    if (settings.clickWaitMax) await wait(Math.random() * (settings.clickWaitMax - settings.clickWaitMin) + settings.clickWaitMin)

    let searchQuery
    if (inputName) {
        searchQuery = educationalElement.inputName
        console.log('ищем (по пользовательскому названию)', searchQuery)
    } else if (cut) {
        searchQuery = educationalElement.name.slice(0, -10)
        console.log('ищем (урезанное название)', searchQuery)
    } else {
        searchQuery = educationalElement.name
        console.log('ищем', educationalElement)
        if (educationalElement.dirty && educationalElement.name) {
            const result = await getAnswersByTopicFromServer(educationalElement.name)
            if (result.topic) {
                educationalElement = result.topic
            }
        }
    }

    const authData = await db.get('other', 'authData')
    let cabinet = await db.get('other', 'cabinet')
    // if (tempCabinet) cabinet = tempCabinet

    let foundEE
    if (educationalElement.id) {
        let response = await fetch(`https://${cabinet}.edu.rosminzdrav.ru/api/api/educational-elements/iom/${educationalElement.id}/`, {
            headers: {authorization: 'Bearer ' + authData.access_token},
            method: 'GET',
            signal: AbortSignal.any([AbortSignal.timeout(Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin), controller.signal])
        })
        if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
        let json = await response.json()
        if (json.globalErrors?.[0]?.code === 'notFound') {
            // TODO у нас проблема с id, в разных кабинетах разные id тем с одинаковым названием
            console.warn('Не удалось найти элемент по id, возможно тут конфликт с id')
            delete educationalElement.id
            delete educationalElement.code
            await db.put('topics', educationalElement)
            await searchEducationalElement(educationalElement, cut, inputName)
            return
        }
        await checkErrors(json)
        foundEE = json
    } else if (searchQuery) {
        let response = await fetch(`https://${cabinet}.edu.rosminzdrav.ru/api/api/educational-elements/search`, {
            headers: {authorization: 'Bearer ' + authData.access_token, 'content-type': 'application/json'},
            body: JSON.stringify({
                topicId: null,
                cycleId: null,
                limit: 10,
                programId: null,
                educationalOrganizationIds: [],
                freeTextQuery: searchQuery.trim(),
                elementType: "iom",
                offset: 0,
                startDate: null,
                endDate: null,
                iomTypeIds: [],
                mainSpecialityNameList: []
            }),
            method: 'POST',
            signal: AbortSignal.any([AbortSignal.timeout(Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin), controller.signal])
        })
        if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
        let json = await response.json()
        await checkErrors(json)
        if (!json.elements.length) {
            if (!cut && educationalElement.code) {
                cut = true
                await searchEducationalElement(educationalElement, cut, inputName)
                return
            } else if (!inputName && educationalElement.inputName) {
                inputName = true
                await searchEducationalElement(educationalElement, cut, inputName)
                return
            } else {
                console.log(json)
                throw new TopicError('По заданному названию ничего не найдено')
            }
        }
        for (const element of json.elements) {
            if (settings.clickWaitMax) await wait(Math.random() * (settings.clickWaitMax - settings.clickWaitMin) + settings.clickWaitMin)
            response = await fetch(`https://${cabinet}.edu.rosminzdrav.ru/api/api/educational-elements/iom/${element.elementId}/`, {
                headers: {authorization: 'Bearer ' + authData.access_token},
                method: 'GET',
                signal: AbortSignal.any([AbortSignal.timeout(Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin), controller.signal])
            })
            if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
            let json2 = await response.json()
            await checkErrors(json2)
            if (educationalElement.code) {
                if (educationalElement.code === json2.number) {
                    foundEE = json2
                    break
                }
            } else if (educationalElement.name === normalizeText(json2.name)) {
                foundEE = json2
                break
            } else if (cut && normalizeText(json2.name).includes(educationalElement.name)) {
                foundEE = json2
                break
            }
        }
    } else {
        throw new TopicError('Нет параметров для поиска (ошибка с id или не найдено по id)')
    }

    if (!foundEE) {
        throw new TopicError('Не найдено')
    }

    if (settings.clickWaitMax) await wait(Math.random() * (settings.clickWaitMax - settings.clickWaitMin) + settings.clickWaitMin)

    foundEE.name = normalizeText(foundEE.name)

    if (educationalElement.name !== foundEE.name) {
        if (educationalElement.name) {
            console.warn('Названия не соответствуют:')
            console.warn(educationalElement.name)
            console.warn(foundEE.name)
            educationalElement.error = 'Есть не соответствие в названии, название было изменено'
        }
        const newTopic = await db.getFromIndex('topics', 'name', foundEE.name)
        if (newTopic) {
            console.warn('Найден дублирующий topic, для исправления он был удалён', JSON.stringify(educationalElement))
            await db.delete('topics', educationalElement._id)
            educationalElement._id = newTopic._id
            if (newTopic.inputName && !educationalElement.inputName) {
                educationalElement.inputName = newTopic.inputName
            }
            if (newTopic.inputIndex != null && educationalElement.inputIndex == null) {
                educationalElement.inputIndex = newTopic.inputIndex
            }
        }
    }
    // на случай если поиск был по id
    if (!(educationalElement.dirty && educationalElement.id && !educationalElement.name)) {
        delete educationalElement.dirty
    }
    if (educationalElement.id !== foundEE.id) {
        educationalElement.id = foundEE.id
    }
    if (educationalElement.name !== foundEE.name) {
        educationalElement.name = foundEE.name
    }
    if (educationalElement.code !== foundEE.number) {
        educationalElement.code = foundEE.number
    }
    // educationalElement.completed = completed
    // educationalElement.status = status
    await db.put('topics', educationalElement)

    if (foundEE.iomHost?.name) {
        if (!foundEE.iomHost.name.includes('Платформа онлайн-обучения Портала')) {
            throw new TopicError('Данный элемент не возможно пройти так как данная платформа обучения не поддерживается расширением')
        }
    }

    if (!foundEE.completed && foundEE.status !== 'included') {
        let response = await fetch(`https://${cabinet}.edu.rosminzdrav.ru/api/api/educational-elements/iom/${foundEE.id}/plan`, {
            headers: {authorization: 'Bearer ' + authData.access_token},
            method: 'PUT',
            signal: AbortSignal.any([AbortSignal.timeout(Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin), controller.signal])
        })
        if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
        if (!response.ok) {
            let json = await response.json()
            await checkErrors(json)
            if (json.globalErrors?.[0]?.code === 'ELEMENT_CANNOT_BE_ADDED_TO_PLAN_EXCEPTION') {
                throw new TopicError(JSON.stringify(json))
            }
        }
        if (settings.clickWaitMax && settings.clickWaitMax > 500) {
            await wait(Math.random() * (settings.clickWaitMax - settings.clickWaitMin) + settings.clickWaitMin)
        } else {
            await wait(Math.random() * (10000 - 5000) + 5000)
        }
    } else {
        if (foundEE.completed) {
            console.warn('данный элемент уже пройден пользователем', foundEE)
            // TODO мы не можем пропустить открытие теста не смотря на то что оно уже пройдено
            //  так как иногда бывает зависание теста (с пропажей кнопок получения варианта, вперёд и назад)
            // throw new TopicError('Уже пройдено')
        }
    }

    let response = await fetch(`https://${cabinet}.edu.rosminzdrav.ru/api/api/educational-elements/iom/${foundEE.id }/open-link?backUrl=https%3A%2F%2F${cabinet}.edu.rosminzdrav.ru%2F%23%2Fuser-account%2Fmy-plan`, {
        headers: {authorization: 'Bearer ' + authData.access_token},
        method: 'GET',
        signal: AbortSignal.any([AbortSignal.timeout(Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin), controller.signal])
    })
    if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
    let json = await response.json()
    await checkErrors(json)
    console.log('открываем', educationalElement.name)
    if (!json.url) {
        console.log(json)
        console.log(educationalElement)
        throw Error('Не была получена ссылка по теме ' + educationalElement.name)
    }
    if (!new URL(json.url).host.includes('edu.rosminzdrav.ru')) {
        throw new TopicError('Данный элемент не возможно пройти так как данная платформа обучения не поддерживается расширением')
    }
    // tempCabinet = null
    return json.url
}

async function checkErrors(json) {
    if (json.error) {
        if (json.error_description?.includes('token expired') || json.error_description?.includes('access token')) {
            const authData = await db.get('other', 'authData')
            const cabinet = await db.get('other', 'cabinet')
            if (authData?.refresh_token) {
                const response = await fetch(`https://${cabinet}.edu.rosminzdrav.ru/api/api/v2/oauth/token?grant_type=refresh_token&refresh_token=${authData.refresh_token}`, {
                    headers: {"Content-Type": "application/x-www-form-urlencoded", Authorization: 'Basic ' + btoa(`client:secret`)},
                    method: 'POST',
                    signal: AbortSignal.any([AbortSignal.timeout(Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin), controller.signal])
                })
                if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
                const json2 = await response.json()
                console.log(json2)
                if (json2?.access_token) {
                    await db.put('other', json2, 'authData')
                } else {
                    console.error('Не удалось обновить access_token')
                    throw Error('Не удалось обновить access_token ' + JSON.stringify(json2).slice(0, 150))
                }
                throw Error('Updated token')
            }
        }
        console.error(json)
        throw Error('НМО выдал ошибку при попытке поиска ' + JSON.stringify(json).slice(0, 150))
    } else if (json.globalErrors?.[0]?.code === 'notFound') {
        throw new TopicError(JSON.stringify(json.globalErrors))
    } /* else if (json.globalErrors?.[0]?.code === 'notFound') {
        // TODO кривой костыль если у нас этот ИОМ можно пройти только в другом кабинете (по образованию)
        if (!tempCabinet) {
            tempCabinet = 'nmfo-spo'
            throw Error('notFound')
        } else {
            tempCabinet = null
            throw new TopicError('Не найдено')
        }
    }*/
}

chrome.tabs.onRemoved.addListener((tabId) => {
    if (runningTab === tabId) {
        console.warn('Работа расширения остановлена, пользователь закрыл вкладку')
        stop()
    }
})

chrome.runtime.onConnect.addListener((port) => {
    port.onMessage.addListener(async (message) => {
        await initializeFunc
        setReloadTabTimer()
        if (message.question) {
            let error
            lastScore = null
            let searchedOnServer
            let topic = await db.getFromIndex('topics', 'name', message.question.topics[0])
            if (!topic || topic.dirty) {
                searchedOnServer = true
                const result = await getAnswersByTopicFromServer(message.question.topics[0])
                error = result.error
                if (result.topic) {
                    topic = result.topic
                } else if (!topic) {
                    topic = {name: message.question.topics[0]}
                    topic._id = await db.put('topics', topic)
                    console.log('Внесена новая тема в базу', message.question.topics[0])
                } else if (topic.dirty && !result.error) {
                    delete topic.dirty
                    await db.put('topics', topic)
                }
            }
            let question = await db.getFromIndex('questions', 'question', message.question.question)
            if (!question) {
                searchedOnServer = true
                const result = await getAnswersByQuestionFromServer(message.question.question)
                if (result?.question) {
                    question = result.question
                }
                error = result?.error
            }
            // работа с найденным вопросом
            if (question) {
                const answerHash = objectHash(message.question.answers.answers)
                if (!searchedOnServer && !question.answers[answerHash]) {
                    const result = await getAnswersByQuestionFromServer(message.question.question)
                    if (result?.question) {
                        question = result.question
                    }
                    error = result?.error
                }
                // добавление другого варианта ответов (в одном вопросе может быть несколько вариаций ответов с разными ответами)
                if (!question.answers[answerHash]) {
                    question.answers[answerHash] = message.question.answers
                    if (!question.lastOrder) question.lastOrder = {}
                    question.lastOrder[message.question.lastOrder] = answerHash
                    const multi = question.answers[answerHash].type.toLowerCase().includes('несколько')
                    question.answers[answerHash].combinations = getCombinations(Array.from(question.answers[answerHash].answers.keys()), multi)
                    // если у нас есть уже правильные ответы, попытаемся использовать их, а потом подбирать вариации ответов, вдруг прокатит (да и на тот случай если эти ответы были вручную добавлены)
                    let hasRightAnswer = false
                    if (question.correctAnswers) {
                        for (const correctAnswers of Object.values(question.correctAnswers)) {
                            for (const answer of correctAnswers) {
                                if (question.answers[answerHash].answers.includes(answer)) {
                                    hasRightAnswer = true
                                    break
                                }
                            }
                        }
                    }
                    let answers = []
                    if (hasRightAnswer) {
                        for (const correctAnswers of Object.values(question.correctAnswers)) {
                            for (const answer of correctAnswers) {
                                if (!answers.includes(answer)) {
                                    answers.push(answer)
                                }
                            }
                        }
                        console.log('попробуем использовать правильные ответы которые есть', question)
                    } else {
                        // предлагаем рандомный предполагаемый вариант правильного ответа
                        const combination = question.answers[answerHash].combinations[Math.floor(Math.random()*question.answers[answerHash].combinations.length)]
                        answers = combination.map(index => question.answers[answerHash].answers[index])
                        console.log('добавлены новые варианты ответов', question)
                    }
                    question.answers[answerHash].lastUsedAnswers = answers
                    port?.postMessage({answers, question, answerHash, error})
                // если найден и вопрос и к нему вариант ответов
                } else {
                    if (!question.lastOrder) question.lastOrder = {}
                    question.lastOrder[message.question.lastOrder] = answerHash
                    if (!searchedOnServer && !question.correctAnswers[answerHash]?.length) {
                        const result = await getAnswersByQuestionFromServer(message.question.question)
                        if (result?.question) {
                            question = result.question
                        }
                        error = result?.error
                    }
                    if (!question.answers[answerHash].type && message.question.answers.type) {
                        question.answers[answerHash].type = message.question.answers.type
                    } else if (question.answers[answerHash].type && message.question.answers.type && question.answers[answerHash].type.toLowerCase().includes('несколько') !== message.question.answers.type.toLowerCase().includes('несколько')) {
                        question.answers[answerHash].type = message.question.answers.type
                        if (question.correctAnswers[answerHash]?.length > 1) {
                            console.warn('Тип вопроса не соответствует с тем что было в бд, возможно портал изменил ответ, правильные ответы были удалены (заново сгенерированы комбинации)')
                            delete question.correctAnswers[answerHash]
                            const multi = question.answers[answerHash].type?.toLowerCase()?.includes('несколько')
                            question.answers[answerHash].combinations = getCombinations(Array.from(question.answers[answerHash].answers.keys()), multi)
                        }
                    }
                    // отправляем правильный ответ если он есть
                    if (question.correctAnswers[answerHash]?.length) {
                        console.log('отправлен ответ', question)
                        port?.postMessage({answers: question.correctAnswers[answerHash], question, correct: true, answerHash})
                    // если нет правильных ответов, предлагаем рандомный предполагаемый вариант правильного ответа
                    } else {
                        let combination = question.answers[answerHash].combinations?.[Math.floor(Math.random()*question.answers[answerHash].combinations?.length)]
                        let answers = []
                        if (question.answers[answerHash].lastUsedAnswers) {
                            console.log('даны те ответы что расширение раньше предлагало', question)
                            answers = question.answers[answerHash].lastUsedAnswers
                        } else if (combination?.length) {
                            console.log('предложен другой вариант ответа', question)
                            answers = combination.map(index => question.answers[answerHash].answers[index])
                        } else {
                            console.warn('Нет вариантов ответов!')
                            // если уж на то пошло, заново генерируем комбинации
                            const multi = question.answers[answerHash].type?.toLowerCase()?.includes('несколько')
                            question.answers[answerHash].combinations = getCombinations(Array.from(question.answers[answerHash].answers.keys()), multi)
                            combination = question.answers[answerHash].combinations[Math.floor(Math.random()*question.answers[answerHash].combinations.length)]
                            // если у нас есть ответы с других вариантов, пробуем их использовать с начало
                            let hasRightAnswer = false
                            if (question.correctAnswers) {
                                for (const correctAnswers of Object.values(question.correctAnswers)) {
                                    for (const answer of correctAnswers) {
                                        if (question.answers[answerHash].answers.includes(answer)) {
                                            hasRightAnswer = true
                                            break
                                        }
                                    }
                                }
                            }
                            if (hasRightAnswer) {
                                for (const correctAnswers of Object.values(question.correctAnswers)) {
                                    for (const answer of correctAnswers) {
                                        if (!answers.includes(answer)) {
                                            answers.push(answer)
                                        }
                                    }
                                }
                                console.log('попробуем использовать правильные ответы которые есть (заново сгенерированы комбинации)', question)
                            } else {
                                answers = combination.map(index => question.answers[answerHash].answers[index])
                                console.log('предложен другой вариант ответа (заново сгенерированы комбинации)', question)
                            }
                        }
                        question.answers[answerHash].lastUsedAnswers = answers
                        port?.postMessage({answers, question, answerHash, error})
                    }
                }
                if (!question.topics.includes(topic._id)) {
                    question.topics.push(topic._id)
                }
                await db.put('questions', question)
            // добавление вопроса с его вариантами ответов
            } else {
                question = message.question
                const multi = question.answers.type.toLowerCase().includes('несколько')
                question.answers.combinations = getCombinations(Array.from(question.answers.answers.keys()), multi)
                const combination = question.answers.combinations[Math.floor(Math.random()*question.answers.combinations.length)]
                let answers = combination.map(index => question.answers.answers[index])
                const answerHash = objectHash(question.answers.answers)
                question.answers = {[answerHash]: question.answers}
                question.lastOrder = {[question.lastOrder]: answerHash}
                question.correctAnswers = {}
                question.topics = [topic._id]
                console.log('добавлен новый вопрос', question)
                question.answers[answerHash].lastUsedAnswers = answers
                port?.postMessage({answers, question, answerHash, error})
                await db.put('questions', question)
            }
        // сохранение результатов теста с правильными и не правильными ответами
        } else if (message.results) {
            let stats = {correct: 0, taken: 0, ignored: 0}

            let topic = await db.getFromIndex('topics', 'name', message.topic)
            if (!topic || topic.dirty) {
                const result = await getAnswersByTopicFromServer(message.topic)
                if (result.topic) {
                    topic = result.topic
                } else if (!topic) {
                    topic = {name: message.topic}
                    topic._id = await db.put('topics', topic)
                    console.log('Внесена новая тема в базу', message.topic)
                } else if (topic.dirty && !result.error) {
                    delete topic.dirty
                    await db.put('topics', topic)
                }
            }
            lastScore = message.lastScore

            const toSendResults = []

            for (const resultQuestion of message.results) {
                let question = await db.getFromIndex('questions', 'question', resultQuestion.question)
                // если мы получили ответ, но в бд его нет, сохраняем если этот ответ правильный
                if (!question) {
                    if (resultQuestion.correct) {
                        question = {
                            question: resultQuestion.question,
                            answers: {},
                            topics: [topic._id],
                            correctAnswers: {'unknown': resultQuestion.answers.usedAnswers}
                        }
                        question._id = await db.put('questions', question)
                        console.log('записан новый ответ с новым вопросом', question)
                        stats.correct++
                    } else {
                        console.log('пропущено', resultQuestion)
                        stats.ignored++
                    }
                // сохраняем правильный ответ или учитываем не правильный ответ
                } else {
                    let changedCombinations = false
                    let changedAnswers = false
                    let changedOther = false
                    let notAnswered = false
                    const foundAnswerHash = question.lastOrder?.[resultQuestion.lastOrder]
                    // если ответ правильный, сохраняем правильные ответы, и удаляем combinations находя по ответам нужный вариант ответов
                    if (resultQuestion.answers.usedAnswers?.length && resultQuestion.correct) {
                        const searchAnswers = foundAnswerHash ? [foundAnswerHash] : Object.keys(question.answers)
                        const matchAnswers = []
                        for (const answerHash of searchAnswers) {
                            let wrongVariant = false
                            if (question.answers[answerHash].type && Boolean(resultQuestion.answers.type?.toLowerCase?.()?.includes?.('несколько')) !== question.answers[answerHash].type.toLowerCase().includes('несколько')) {
                                wrongVariant = true
                            }

                            for (const answer of resultQuestion.answers.usedAnswers) {
                                if (wrongVariant) break
                                if (!question.answers[answerHash].answers.includes(answer)) {
                                    wrongVariant = true
                                }
                            }
                            if (wrongVariant) {
                                if (foundAnswerHash) {
                                    console.warn('lastOrder не соответствует вариантам ответов что сохранены в бд', question, resultQuestion)
                                }
                                continue
                            }

                            if (!matchAnswers.includes(answerHash)) {
                                matchAnswers.push(answerHash)
                            }
                        }
                        if (matchAnswers.length > 1) {
                            console.warn('Найдено больше 1-го варианта ответов, не возможно сохранить правильный ответ', resultQuestion, question)
                            stats.ignored++
                        } else if (!matchAnswers.length) {
                            const oldAnswers = JSON.stringify(question.correctAnswers['unknown'])
                            if (!question.correctAnswers['unknown']) question.correctAnswers['unknown'] = []
                            question.correctAnswers['unknown'] = Array.from(new Set(question.correctAnswers['unknown'].concat(resultQuestion.answers.usedAnswers)))
                            changedAnswers = oldAnswers !== JSON.stringify(question.correctAnswers)
                            if (changedAnswers) stats.taken++
                        } else {
                            let fakeCorrectAnswers = false
                            if (question.correctAnswers[matchAnswers[0]]) {
                                if (JSON.stringify(question.correctAnswers[matchAnswers[0]]) !== JSON.stringify(resultQuestion.answers.usedAnswers)) {
                                    if (!question.answers[matchAnswers[0]].fakeCorrectAnswers || question.answers[matchAnswers[0]].fakeCorrectAnswers <= 0) {
                                        fakeCorrectAnswers = true
                                        changedCombinations = true
                                        if (!question.answers[matchAnswers[0]].fakeCorrectAnswers || question.answers[matchAnswers[0]].fakeCorrectAnswers === true) {
                                            question.answers[matchAnswers[0]].fakeCorrectAnswers = 0
                                        }
                                        question.answers[matchAnswers[0]].fakeCorrectAnswers++
                                        console.warn('Результат с правильными ответами не соответствует с бд, в бд были не правильные ответы? Возможно это сбой какой-то', question, resultQuestion, JSON.stringify(question.correctAnswers[matchAnswers[0]]), JSON.stringify(resultQuestion.answers.usedAnswers))
                                    } else {
                                        console.warn('Результат с правильными ответами не соответствует с бд, в бд были не правильные ответы? Были перезаписаны правильные ответы', question, resultQuestion, JSON.stringify(question.correctAnswers[matchAnswers[0]]), JSON.stringify(resultQuestion.answers.usedAnswers))
                                        changedAnswers = true
                                        question.correctAnswers[matchAnswers[0]] = resultQuestion.answers.usedAnswers
                                    }
                                    stats.taken++
                                } else {
                                    stats.ignored++
                                }
                            } else {
                                changedAnswers = true
                                question.correctAnswers[matchAnswers[0]] = resultQuestion.answers.usedAnswers
                                stats.correct++
                            }
                            if (question.answers[matchAnswers[0]].combinations) {
                                changedCombinations = true
                                delete question.answers[matchAnswers[0]].combinations
                            }
                            if (question.correctAnswers['unknown']) {
                                for (const answer of resultQuestion.answers.usedAnswers) {
                                    const index = question.correctAnswers['unknown'].indexOf(answer)
                                    if (index !== -1) {
                                        changedAnswers = true
                                        question.correctAnswers['unknown'].splice(index, 1)
                                    }
                                }
                            }
                            if (question.correctAnswers['unknown']?.length === 0) {
                                changedAnswers = true
                                delete question.correctAnswers['unknown']
                            }
                            if (!fakeCorrectAnswers && question.answers[matchAnswers[0]].fakeCorrectAnswers) {
                                changedCombinations = true
                                delete question.answers[matchAnswers[0]].fakeCorrectAnswers
                            }
                        }
                    // если ответ не правильный, удаляем ту комбинацию (combination) которую мы использовали при подборе ответа
                    } else if (resultQuestion.answers.usedAnswers?.length) {
                        const searchAnswers = foundAnswerHash ? [foundAnswerHash] : Object.keys(question.answers)
                        let fakeCorrectAnswers = false
                        // если у нас есть правильный ответ, но мы получили что этот ответ НЕ правильный, то значит у нас в бд неверные данные, удаляем ответ и генерируем комбинации для подбора ответа
                        if (question.correctAnswers[foundAnswerHash]) {
                            if (JSON.stringify(question.correctAnswers[foundAnswerHash]) !== JSON.stringify(resultQuestion.answers.usedAnswers)) {
                                console.warn('На вопрос были даны НЕ правильные ответы не смотря на то что в бд есть ПРАВИЛЬНЫЕ ответы', JSON.stringify(question.correctAnswers[foundAnswerHash]), JSON.stringify(resultQuestion.answers.usedAnswers), question)
                            } else {
                                // TODO иногда какого-то хрена правильные ответы выдаются как неверные, мы пробуем костылём во второй раз ответить
                                //  но если и во второй раз не прокатит то удаляем правилные ответы и пробуем методом подбора подобрать правильные ответы
                                if (!question.answers[foundAnswerHash].fakeCorrectAnswers || question.answers[foundAnswerHash].fakeCorrectAnswers <= 0) {
                                    console.warn('Пока какой-то причине НМО посчитал правильные ответы НЕ правильными, возможно это сбой какой-то', question, resultQuestion)
                                    changedCombinations = true
                                    fakeCorrectAnswers = true
                                    if (!question.answers[foundAnswerHash].fakeCorrectAnswers || question.answers[foundAnswerHash].fakeCorrectAnswers === true) {
                                        question.answers[foundAnswerHash].fakeCorrectAnswers = 0
                                    }
                                    question.answers[foundAnswerHash].fakeCorrectAnswers++
                                } else {
                                    console.warn('Похоже что правильные ответы на самом деле НЕ правильные (правильный ответ удалён, заново сгенерированы комбинации)')
                                    changedAnswers = true
                                    changedCombinations = true
                                    fakeCorrectAnswers = true
                                    delete question.answers[foundAnswerHash].fakeCorrectAnswers
                                    delete question.correctAnswers[foundAnswerHash]
                                    const multi = (question.answers[foundAnswerHash].type || resultQuestion.answers.type)?.toLowerCase()?.includes('несколько')
                                    question.answers[foundAnswerHash].combinations = getCombinations(Array.from(question.answers[foundAnswerHash].answers.keys()), multi)
                                }
                            }
                        }
                        const matchAnswers = []
                        for (const answerHash of searchAnswers) {
                            let wrongVariant = false
                            // TODO если мы по заданному lastOrder не нашли нужный вариант ответов то это может попортить остальные комбинации ответов если они будут совпадать
                            if (!question.answers[answerHash].combinations) {
                                wrongVariant = true
                            }

                            if (question.answers[answerHash].type && Boolean(resultQuestion.answers.type?.toLowerCase?.()?.includes?.('несколько')) !== question.answers[answerHash].type.toLowerCase().includes('несколько')) {
                                wrongVariant = true
                            }

                            let indexes = []
                            for (const answer of resultQuestion.answers.usedAnswers) {
                                if (wrongVariant) break
                                const index = question.answers[answerHash].answers.indexOf(answer)
                                if (index === -1) {
                                    wrongVariant = true
                                } else {
                                    indexes.push(index)
                                }
                            }
                            
                            if (wrongVariant) continue

                            indexes = JSON.stringify(indexes.sort())
                            for (const [index, combination] of question.answers[answerHash].combinations.entries()) {
                                if (JSON.stringify(combination) === indexes) {
                                    matchAnswers.push({answerHash, index})
                                }
                            }
                        }
                        if (matchAnswers.length > 1) {
                            console.warn('Найдено больше 1-го варианта ответов, не возможно сохранить использованную комбинацию', resultQuestion, question)
                            stats.ignored++
                        } else if (!matchAnswers.length) {
                            if (foundAnswerHash) {
                                // TODO возможно тут следует заново генерировать комбинации, правда это чревато цикличным подбором ответов
                                console.warn('пропущено, не найдена комбинация по заданному lastOrder', resultQuestion, question, question.lastOrder)
                            } else {
                                console.warn('пропущено, не найдена комбинация', resultQuestion, question)
                            }
                            stats.ignored++
                        } else if (!fakeCorrectAnswers) {
                            // удаляем ту комбинацию которая была использована при попытке
                            changedCombinations = true
                            question.answers[matchAnswers[0].answerHash].combinations.splice(matchAnswers[0].index, 1)
                            stats.taken++
                        }
                    } else {
                        notAnswered = true
                        console.log('пропущено, не предоставлены ответы', resultQuestion, question)
                        stats.ignored++
                    }
                    if (foundAnswerHash) {
                        if (!notAnswered && !settings.offlineMode && settings.sendResults) {
                            const toSendQuestion = {
                                question: question.question,
                                answers: {
                                    answers: question.answers[foundAnswerHash].answers,
                                    type: question.answers[foundAnswerHash].type,
                                    usedAnswers: question.answers[foundAnswerHash].lastUsedAnswers || resultQuestion.answers.usedAnswers
                                },
                                correct: resultQuestion.correct
                            }
                            toSendResults.push(toSendQuestion)
                        }

                        changedOther = true
                        delete question.lastOrder?.[resultQuestion.lastOrder]
                        if (!notAnswered) delete question.answers[foundAnswerHash].lastUsedAnswers

                        if (!question.topics.includes(topic._id)) {
                            changedCombinations = true
                            question.topics.push(topic._id)
                        }
                    }

                    if (changedAnswers || changedCombinations || changedOther) {
                        await db.put('questions', question)
                        if (changedAnswers) {
                            console.log('записан или изменён новый ответ', resultQuestion, question)
                        } else {
                            // пока что ничего
                        }
                    }
                }
            }

            let error
            if (toSendResults.length) {
                const result = await sendResultsToServer(toSendResults, topic.name)
                if (result?.stats) {
                    stats = result.stats
                    stats.isServer = true
                } else if (result?.error) {
                    error = result.error
                }
            }

            port?.postMessage({stats, error})
        } else if (message.running != null || message.collectAnswers != null) {
            if (message.running || message.collectAnswers) {
                if (message.collectAnswers) collectAnswers = message.collectAnswers
                runningTab = port.sender.tab.id
                // chrome.action.setBadgeText({text: 'ON'})
            }
        } else if (message.done) {
            lastScore = null
            let educationalElement = await db.getFromIndex('topics', 'name', message.topic)
            console.log('закончено', message.topic)
            // TODO это конечно безобразие но другого варианта нет как проходить тесты в которых названии не соответсвует
            //  данный костыль чревато тем что если пользователь откроет сам сторонний тест то расширение ошибочно засчитает другой тест как завершённый
            if (!educationalElement && !message.hasTest) {
                educationalElement = await db.getFromIndex('topics', 'completed, inputIndex', IDBKeyRange.bound([0, 0], [0, Infinity]))
            }
            if (educationalElement) {
                if (message.error) {
                    showNotification('Предупреждение', message.error)
                    educationalElement.completed = 2
                    educationalElement.error = message.error
                } else {
                    educationalElement.completed = 1
                }
                await db.put('topics', educationalElement)
                if (educationalElement.inputIndex != null) {
                    chrome.runtime.sendMessage({updatedTopic: educationalElement}, function () {
                        const lastError = chrome.runtime.lastError?.message
                        if (!lastError.includes('Receiving end does not exist') && !lastError.includes('message port closed before a response was received')) {
                            console.error(lastError)
                        }
                    })
                }
            }
            if (!message.hasTest) {
                startFunc = start(runningTab, false, true)
                startFunc.finally(() => startFunc.done = true)
            }
        } else if (message.error) {
            showNotification('Предупреждение', message.error)
            startFunc = start(runningTab, true, false, true)
            startFunc.finally(() => startFunc.done = true)
        } else {
            console.warn(message)
        }
    })

    waitUntilState(true)

    port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message
        if (error) {
            // просто игнорируем это безобразие (хз как это фиксить)
            if (error !== 'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.') {
                console.error(error)
            }
        }
        if (!runningTab) waitUntilState(false)
        port = null
    })

})

// https://www.kodeclik.com/array-combinations-javascript/
function getCombinations(items, multi) {
    const combinations = []

    function generateCombinations(arr, size, start, temp) {
        if (temp.length === size) {
            combinations.push([...temp])
            return
        }

        for (let i = start; i < arr.length; i++) {
            temp.push(arr[i])
            generateCombinations(arr, size, i + 1, temp)
            temp.pop()
        }
    }

    if (multi) {
        for (let i = 1; i <= items.length; i++) {
            generateCombinations(items, i, 0, [])
        }
    } else{
        generateCombinations(items, 1, 0, [])
    }

    return combinations
}

async function sendResultsToServer(results, topic) {
    if (settings.offlineMode || !settings.sendResults) return
    try {
        const response = await fetch('https://serega007.ru/saveResults', {
            headers: {'Content-Type': 'application/json'},
            method: 'POST',
            body: JSON.stringify({results, topic}),
            signal: AbortSignal.timeout(Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin)
        })
        // noinspection UnnecessaryLocalVariableJS
        const json = await response.json()
        return json
    } catch (error) {
        console.error(error)
        return {error: 'Не удалось связаться с сервером ответов'}
    }
}

async function getAnswersByQuestionFromServer(question) {
    if (settings.offlineMode) return
    try {
        const response = await fetch('https://serega007.ru/getQuestionByName', {
            headers: {'Content-Type': 'application/json'},
            method: 'POST',
            body: JSON.stringify({name: question}),
            signal: AbortSignal.timeout(Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin)
        })
        const json = await response.json()
        if (json) {
            const question = await joinQuestion(json)
            return {question}
        }
    } catch (e) {
        console.error(e)
        return {error: 'Не удалось связаться с сервером ответов'}
    }
}

async function getAnswersByTopicFromServer(topicName) {
    let topic, error
    try {
        if (!settings.offlineMode) {
            const response = await fetch('https://serega007.ru/getQuestionsByTopic', {
                headers: {'Content-Type': 'application/json'},
                method: 'POST',
                body: JSON.stringify({name: topicName}),
                signal: AbortSignal.timeout(Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin)
            })
            const json = await response.json()
            if (json) {
                topic = await putNewTopic(json.topic, null, true)
                for (const question of json.questions) {
                    await joinQuestion(question)
                }
            }
        }
    } catch (e) {
        error = 'Не удалось связаться с сервером ответов'
        console.error(e)
    }
    return {topic, error}
}

async function joinQuestion(newQuestion) {
    const question = await db.getFromIndex('questions', 'question', newQuestion.question)
    if (!question) {
        console.log('С интернета добавлен новый вопрос', newQuestion)
        await db.put('questions', newQuestion)
        return newQuestion
    }

    let changed, changedAnswers
    for (const answersHash of Object.keys(newQuestion.answers)) {
        if (!question.answers[answersHash]) {
            changed = true
            question.answers[answersHash] = newQuestion.answers[answersHash]
        }
        if (!question.correctAnswers[answersHash] && newQuestion.correctAnswers[answersHash]) {
            changedAnswers = true
            question.correctAnswers[answersHash] = newQuestion.correctAnswers[answersHash]
            delete question.answers[answersHash].combinations
        }
        if (newQuestion.answers[answersHash].combinations && !question.correctAnswers[answersHash]) {
            if (!question.answers[answersHash].combinations?.length) {
                question.answers[answersHash].combinations = newQuestion.answers[answersHash].combinations
            } else {
                question.answers[answersHash].combinations = question.answers[answersHash].combinations.filter(subArray =>
                    newQuestion.answers[answersHash].combinations.some(refArray =>
                        refArray.length === subArray.length && refArray.every((val, index) => val === subArray[index])
                    )
                )
            }
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
    if (changed || changedAnswers) {
        await db.put('questions', question)
        console.log('С интернета обновлён вопрос', question)
        return question
    }
}

function showNotification(title, message) {
    console.log(title, message)
    chrome.action.setTitle({title: message})
    chrome.notifications.create({type: 'basic', message, title, iconUrl: 'img/icon128.png'})
}

function wait(ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            rejectWait = null
            resolve()
        }, ms)
        rejectWait = () => {
            rejectWait = null
            clearTimeout(timer)
            reject('stopped by user')
        }
    })
}

function setReloadTabTimer() {
    if (settings?.mode === 'manual' || settings?.mode === 'disabled') return
    if (Date.now() - lastResetReloadTabTimer <= 5000) return
    clearTimeout(reloadTabTimer)
    reloadTabTimer = setTimeout(async () => {
        if (stopRunning || !runningTab) return
        console.warn('Похоже вкладка совсем зависла, делаем перезапуск теста')
        const tab = await chrome.tabs.discard(runningTab)
        runningTab = tab.id
        startFunc = start(runningTab, true, false, true)
        startFunc.finally(() => startFunc.done = true)
        showNotification('Предупреждение', 'Похоже вкладка совсем зависла, делаем перезапуск теста')
    }, Math.max(180 * 1000, settings.timeoutReloadTabMax + settings.clickWaitMax + 30000, settings.clickWaitMax, settings.answerWaitMax + settings.clickWaitMax + 30000))
    lastResetReloadTabTimer = Date.now()
}

function stop(resetAction=true) {
    runningTab = null
    lastScore = null
    collectAnswers = null
    stopRunning = true
    started = 0
    if (rejectWait) rejectWait()
    controller.abort()
    controller = new AbortController()
    waitUntilState(false)
    clearTimeout(reloadTabTimer)
    if (!resetAction) return
    chrome.action.setTitle({title: chrome.runtime.getManifest().action.default_title})
    chrome.action.setBadgeText({text: ''})
}

// тупорылый костыль (официально одобренный самим гуглом) на то что б Service Worker не отключался во время выполнения кода
async function waitUntil(promise) {
    const keepAlive = setInterval(chrome.runtime.getPlatformInfo, 15 * 1000)
    try {
        await promise
    } finally {
        clearInterval(keepAlive)
    }
}
let timerKeepAlive
function waitUntilState(state) {
    if (state) {
        if (!timerKeepAlive) {
            timerKeepAlive = setInterval(chrome.runtime.getPlatformInfo, 15 * 1000)
        }
    } else {
        clearInterval(timerKeepAlive)
        timerKeepAlive = null
    }
}
