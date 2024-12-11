import { openDB } from '/libs/idb.js';
import { default as objectHash } from '/libs/object-hash.js';
import { JSDOM } from '/libs/jsdom.js';
import '/utils.js'

self.JSDOM = JSDOM // TODO для меньшей нагрузки следует эту реализацию заменить на API chrome.offscreen (ну и говно-код же получится с его использованием)
self.objectHash = objectHash

let db
let runningTab
let stopRunning = false
let controller
let collectAnswers = 0
let reloaded = 0
let started = 0
let startFunc
let settings

let firstInit = false
const initializeFunc = init()
waitUntil(initializeFunc)
initializeFunc.finally(() => initializeFunc.done = true)
async function init() {
    db = await openDB('nmo', 12, {upgrade})
    self.db = db  // TODO временно
    async function upgrade(db, oldVersion, newVersion, transaction) {
        if (oldVersion !== newVersion) {
            console.log('Обновление базы данных с версии ' + oldVersion + ' на ' + newVersion)
        }

        if (oldVersion === 0) {
            firstInit = true
            const questions = db.createObjectStore('questions', {autoIncrement: true})
            questions.createIndex('question', 'question', {unique: true})
            questions.createIndex('topics', 'topics', {multiEntry: true})
            const topics = db.createObjectStore('topics', {autoIncrement: true, keyPath: 'key'})
            topics.createIndex('name', 'name')
            // 0 - не выполнено, 1 - выполнено, 2 - есть ошибки
            topics.createIndex('completed', 'completed')
            topics.createIndex('code', 'code', {unique: true})
            topics.createIndex('id', 'id', {unique: true})
            const other = db.createObjectStore('other')
            await other.put({mode: 'manual'}, 'settings')
            return
        }

        if (oldVersion <= 8) {
            console.log('Этап обновления с версии 8 на 9')
            let cursor = await transaction.objectStore('questions').openCursor()
            while (cursor) {
                const question = cursor.value
                if (question.topic) {
                    let topic = question.topic
                    topic = topic.replaceAll(' - Итоговое тестирование', '').replaceAll(' - Предварительное тестирование', '').replaceAll(' - Входное тестирование', '')
                    if (topic.startsWith('Тест с ответами по теме «')) {
                        topic = topic.replaceAll('Тест с ответами по теме «', '')
                        topic = topic.slice(0, -1)
                    }
                    question.topics = [topic]
                    delete question.topic
                } else {
                    question.topics = []
                }
                await cursor.update(question)
                // noinspection JSVoidFunctionReturnValueUsed
                cursor = await cursor.continue()
            }
        }

        if (oldVersion <= 9) {
            console.log('Этап обновления с версии 9 на 10')

            let cursor = await transaction.objectStore('questions').openCursor()
            while (cursor) {
                const question = cursor.value
                if (question.topics.length) {
                    let changed = false
                    for (const [index, topic] of question.topics.entries()) {
                        if (typeof topic === 'string') {
                            console.warn('Исправлена ошибка с topic', question)
                            changed = true
                            let key = await transaction.objectStore('topics').index('name').getKey(topic)
                            if (key == null) {
                                key = await transaction.objectStore('topics').put({name: topic})
                            }
                            question.topics[index] = key
                        }
                    }
                    if (changed) {
                        await cursor.update(question)
                    }
                }
                // noinspection JSVoidFunctionReturnValueUsed
                cursor = await cursor.continue()
            }
        }

        if (oldVersion <= 10) {
            console.log('Этап обновления с версии 10 на 11')
            let cursor = await transaction.objectStore('questions', 'readwrite').openCursor()
            while (cursor) {
                const question = cursor.value

                question.question = normalizeText(question.question)

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

            let cursor2 = await transaction.objectStore('topics', 'readwrite').openCursor()
            while (cursor2) {
                const topic = cursor2.value
                topic.name = normalizeText(topic.name)
                await cursor2.update(topic)
                // noinspection JSVoidFunctionReturnValueUsed
                cursor2 = await cursor2.continue()
            }
        }

        if (oldVersion <= 11) {
            console.log('Этап обновления с версии 11 на 12')
            let cursor = await transaction.objectStore('questions', 'readwrite').openCursor()
            while (cursor) {
                const count = await transaction.objectStore('questions').index('question').count(cursor.value.question)
                if (count > 1) {
                    // console.warn('Найден дубликат', cursor.value)
                    let cursor2 = await transaction.objectStore('questions', 'readwrite').index('question').openCursor(cursor.value.question)
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

            let cursor2 = await transaction.objectStore('topics', 'readwrite').openCursor()
            while (cursor2) {
                let cursor3 = await transaction.objectStore('topics').index('name').openCursor(cursor2.value.name)
                while (cursor3) {
                    if (cursor2.value.key !== cursor3.value.key) {
                        console.warn('Найден дублирующий topic, для исправления он был удалён', cursor3.value)
                        let count = 0
                        let cursor4 = await transaction.objectStore('questions').index('topics').openCursor(cursor3.value.key)
                        while(cursor4) {
                            count++
                            const question = cursor4.value
                            question.topics.splice(question.topics.indexOf(cursor3.value.key), 1)
                            if (!question.topics.includes(cursor2.value.key)) {
                                question.topics.push(cursor2.value.key)
                            }
                            await cursor4.update(question)
                            // noinspection JSVoidFunctionReturnValueUsed
                            cursor4 = await cursor4.continue()
                        }
                        if (count) {
                            console.warn('Key topic\'а был заменён в следующих кол-во тем', count)
                        }
                        await cursor3.delete()
                    }
                    // noinspection JSVoidFunctionReturnValueUsed
                    cursor3 = await cursor3.continue()
                }
                // noinspection JSVoidFunctionReturnValueUsed
                cursor2 = await cursor2.continue()
            }
        }

        console.log('Обновление базы данных завершено')
    }

    settings = await db.get('other', 'settings')

    if (firstInit) {
        console.log('первая загрузка, загружаем ответы в базу данных')
        let response = await fetch(chrome.runtime.getURL('data/nmo_db.json'))
        let json = await response.json()
        let transaction = db.transaction('questions', 'readwrite').objectStore('questions')
        for (const question of json.questions) {
            await transaction.add(question)
        }

        transaction = db.transaction('topics', 'readwrite').objectStore('topics')
        for (const topic of json.topics) {
            await transaction.put(topic)
        }

        await reimportEducationElements()
        firstInit = false
    }
    console.log('started background!')
}

self.addEventListener('install', () => {
    chrome.contextMenus.create({id: 'download', title: 'Скачать базу данных', contexts: ['action']})
    chrome.contextMenus.onClicked.addListener(async (info) => {
        if (!initializeFunc.done) {
            if (firstInit) {
                showNotification('Подождите', 'Идёт инициализация базы данных, подождите')
                return
            } else {
                await initializeFunc
            }
        }
        if (settings.mode === 'manual' && info.menuItemId === 'download') {
            chrome.tabs.create({url: 'options/options.html'})
        }
    })
})

self.reimportEducationElements = reimportEducationElements
async function reimportEducationElements() {
    const response = await fetch(chrome.runtime.getURL('data/educational-elements.txt'))
    const text = await response.text()

    const transaction = db.transaction('topics', 'readwrite').objectStore('topics')
    let cursor = await transaction.index('completed').openCursor(0)
    while (cursor) {
        delete cursor.value.completed
        await cursor.update(cursor.value)
        // noinspection JSVoidFunctionReturnValueUsed
        cursor = await cursor.continue()
    }

    for (const educationalElement of text.split(/\r?\n/)) {
        if (!educationalElement) continue
        // let ee = educationalElement.split(':')
        // if (ee.length === 1 || !ee[1]?.trim()) {
        //     ee = educationalElement.split(/\t/)
        // }
        let ee = educationalElement.split(/\t/)
        const object = {}
        if (ee.length === 1 && ee[0].trim()) {
            if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(ee[0])) {
                object.id = ee[0]
            } else {
                object.name = normalizeText(ee[0])
            }
        } else if (ee[0]?.trim() && ee[1]?.trim()) {
            object.code = ee[0].trim()
            object.name = normalizeText(ee[1])
        }

        let topic
        if (object.id) {
            topic = await transaction.index('id').get(object.id)
        }
        if (!topic && object.code) {
            topic = await transaction.index('code').get(object.code)
        }
        if (!topic && object.name) {
            topic = await transaction.index('name').get(object.name)
        }
        if (topic) {
            topic.completed = 0
            if (object.id && !topic.id) topic.id = object.id
            if (object.code && !topic.code) topic.code = object.code
            if (object.name && !topic.name) topic.name = object.name
            console.log('Обновлён', topic)
        } else {
            topic = object
            topic.completed = 0
            // TODO временно
            topic.needSearchAnswers = true
            console.log('Добавлен', topic)
        }
        await transaction.put(topic)
    }
}

self.searchDupQuestions = searchDupQuestions
async function searchDupQuestions() {
    let transaction = db.transaction('questions').objectStore('questions')
    let cursor = await transaction.openCursor()
    while (cursor) {
        const count = await transaction.index('question').count(cursor.value.question)
        if (count > 1) {
            console.warn('Найден дубликат', cursor.value)
        }
        // noinspection JSVoidFunctionReturnValueUsed
        cursor = await cursor.continue()
    }
}

self.joinQuestions = joinQuestions
async function joinQuestions() {
    console.log('Объединение баз данных запущено')
    let response = await fetch(chrome.runtime.getURL('data/nmo_db_new.json'))
    let json = await response.json()
    const transaction = db.transaction(['questions', 'topics'], 'readwrite')
    const oldTopics = {}
    for (const newTopic of json.topics) {
        oldTopics[newTopic.key] = newTopic.name
        const count = await transaction.objectStore('topics').index('name').count(newTopic.name)
        if (!count) {
            delete newTopic.key
            await transaction.objectStore('topics').put(newTopic)
        }
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
            console.log('добавлен', newQuestion)
            await transaction.objectStore('questions').add(newQuestion)
        } else {
            let question = await transaction.objectStore('questions').get(key)
            let changed = false
            for (const answersHash of Object.keys(newQuestion.answers)) {
                if (!question.answers[answersHash] || (!question.answers[answersHash].type && newQuestion.answers[answersHash].type)) {
                    changed = true
                    question.answers[answersHash] = newQuestion.answers[answersHash]
                }
                if (!question.correctAnswers[answersHash] && newQuestion.correctAnswers[answersHash]) {
                    changed = true
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
                        changed = true
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
                if (!topics.includes(oldTopics[topicKey])) {
                    const newTopicKey = await transaction.objectStore('topics').index('name').getKey(oldTopics[topicKey])
                    if (newTopicKey == null) {
                        console.warn('Проблема при объединении баз данных, не найдена тема', oldTopics[topicKey], topicKey)
                        continue
                    }
                    changed = true
                    question.topics.push(newTopicKey)
                }
            }

            if (changed) {
                console.log('обновлён', question)
                await transaction.objectStore('questions').put(question, key)
            }
        }
    }
    console.log('Объединение баз данных окончено')
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
    let cursor = await db.transaction('questions').store.index('topics').openCursor(result.value.key)
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
        if (firstInit) {
            sendResponse({running: false, initializing: true})
        } else {
            (async () => {
                await initializeFunc
                const settings = await db.get('other', 'settings')
                sendResponse({running: runningTab === sender.tab.id, collectAnswers, settings})
            })()
            return true
        }
    } else if (message.reloadPage) {
        if (message.error) {
            console.warn('Похоже на вкладке где решается тест что-то зависло, сделана перезагрузка вкладки', message.error)
            reloaded++
            if (reloaded >= 7) {
                startFunc = start(runningTab, true, false, true)
                startFunc.finally(() => startFunc.done = true)
                showNotification('Предупреждение', 'Слишком много попыток перезагрузить страницу')
            } else {
                chrome.tabs.reload(sender.tab.id)
            }
        } else {
            chrome.tabs.reload(sender.tab.id)
        }
    }
})

chrome.action.onClicked.addListener(async (tab) => {
    chrome.action.setTitle({title: chrome.runtime.getManifest().action.default_title})
    chrome.action.setBadgeText({text: ''})
    if (!initializeFunc.done) {
        if (firstInit) {
            showNotification('Подождите', 'Идёт инициализация базы данных, подождите')
            return
        } else {
            chrome.action.setTitle({title: 'Идёт запуск инициализация расширения, подождите...'})
            chrome.action.setBadgeText({text: 'START'})
            await initializeFunc
        }
    }
    if (runningTab === tab.id || (startFunc && !startFunc.done)) {
        started = 0
        console.warn('Работа расширения остановлена по запросу пользователя')
        chrome.tabs.sendMessage(tab.id, {stop: true})
        chrome.action.setTitle({title: chrome.runtime.getManifest().action.default_title})
        chrome.action.setBadgeText({text: ''})
        stopRunning = true
        runningTab = null
        collectAnswers = null
        controller.abort()
    } else {
        let response
        try {
            response = await chrome.tabs.sendMessage(tab.id, {hasTest: true})
        } catch (error) {
            if (error.message.includes('Receiving end does not exist')) {
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
    if (done) {
        started = 0
    } else {
        started++
    }
    if (started >= 30) {
        waitUntilState(false)
        started = 0
        showNotification('Ошибка', 'Слишком много попыток запустить тест')
        chrome.action.setBadgeText({text: 'ERR'})
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
        return
    }
    if (url === 'null') {
        if (done) {
            waitUntilState(false)
            started = 0
            showNotification('Готово', 'Расширение окончил работу')
            chrome.action.setTitle({title: chrome.runtime.getManifest().action.default_title})
            chrome.action.setBadgeText({text: 'DONE'})
            runningTab = null
            collectAnswers = null
            return
        } else if (!hasTest) {
            waitUntilState(false)
            started = 0
            chrome.action.setTitle({title: chrome.runtime.getManifest().action.default_title})
            showNotification('Ошибка', 'На данной странице нет теста или не назначены тесты в настройках')
            chrome.action.setBadgeText({text: 'ERR'})
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
}

async function checkOrGetTopic() {
    const countEE = await db.countFromIndex('topics', 'completed', 0)
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
            const educationalElement = await db.getFromIndex('topics', 'completed', 0)
            if (!educationalElement) return 'null'
            try {
                url = await searchEducationalElement(educationalElement)
                break
            } catch (error) {
                if (stopRunning) return 'error'
                console.warn(error)
                if (error.message.startsWith('Topic error, ')) {
                    educationalElement.error = error.message.replace('Topic error, ', '')
                    educationalElement.completed = 2
                    await db.put('topics', educationalElement)
                } else if (
                    !error.message.startsWith('bad code 5') &&
                    !error.message.startsWith('Не была получена ссылка по теме ') &&
                    error.message !== 'Updated token' &&
                    error.message !== 'signal timed out' &&
                    error.message !== 'Failed to fetch'
                ) {
                    showNotification('W Непредвиденная ошибка', error.message)
                    return 'error'
                }
                await wait(Math.floor(Math.random() * (30000 - 5000) + 5000))
            }
        }
        return url
    }
    return 'null'
}

async function searchEducationalElement(educationalElement, cut, updatedToken) {
    if (cut) {
        educationalElement.name = educationalElement.name.slice(0, -10)
        console.log('ищем (урезанное название)', educationalElement)
    } else {
        console.log('ищем', educationalElement)
    }

    const authData = await db.get('other', 'authData')
    const cabinet = await db.get('other', 'cabinet')

    let foundEE
    if (educationalElement.id) {
        let response = await fetch(`https://${cabinet}.edu.rosminzdrav.ru/api/api/educational-elements/iom/${educationalElement.id}/`, {
            headers: {authorization: 'Bearer ' + authData.access_token},
            method: 'GET',
            signal: AbortSignal.any([AbortSignal.timeout(Math.floor(Math.random() * (90000 - 30000) + 30000)), controller.signal])
        })
        if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
        let json = await response.json()
        await checkErrors(json, updatedToken)
        foundEE = json
    } else {
        let response = await fetch(`https://${cabinet}.edu.rosminzdrav.ru/api/api/educational-elements/search`, {
            headers: {authorization: 'Bearer ' + authData.access_token, 'content-type': 'application/json'},
            body: JSON.stringify({
                topicId: null,
                cycleId: null,
                limit: 10,
                programId: null,
                educationalOrganizationIds: [],
                freeTextQuery: educationalElement.name.trim(),
                elementType: "iom",
                offset: 0,
                startDate: null,
                endDate: null,
                iomTypeIds: [],
                mainSpecialityNameList: []
            }),
            method: 'POST',
            signal: AbortSignal.any([AbortSignal.timeout(Math.floor(Math.random() * (90000 - 30000) + 30000)), controller.signal])
        })
        if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
        let json = await response.json()
        await checkErrors(json, updatedToken)
        if (!json?.elements?.length) {
            if (cut) {
                console.log(json)
                throw Error('По названию ' + educationalElement.name + ' ничего не найдено')
            } else {
                cut = true
                searchEducationalElement(educationalElement, cut, updatedToken)
                return
            }
        }
        for (const element of json.elements) {
            await wait(Math.floor(Math.random() * (10000 - 3000) + 3000))
            response = await fetch(`https://${cabinet}.edu.rosminzdrav.ru/api/api/educational-elements/iom/${element.elementId}/`, {
                headers: {authorization: 'Bearer ' + authData.access_token},
                method: 'GET',
                signal: AbortSignal.any([AbortSignal.timeout(Math.floor(Math.random() * (90000 - 30000) + 30000)), controller.signal])
            })
            if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
            let json2 = await response.json()
            await checkErrors(json2, updatedToken)
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
    }

    if (!foundEE) {
        throw Error('Topic error, Не найдено')
    }

    await wait(Math.floor(Math.random() * (10000 - 3000) + 3000))

    foundEE.name = normalizeText(foundEE.name)

    if (educationalElement.name && educationalElement.name !== foundEE.name) {
        console.warn('Названия не соответствуют:')
        console.warn(educationalElement.name)
        console.warn(foundEE.name)
        educationalElement.error = 'Есть не соответствие в названии, название было изменено'
    }
    educationalElement.id = foundEE.id
    educationalElement.name = foundEE.name
    // educationalElement.completed = completed
    // educationalElement.status = status
    educationalElement.code = foundEE.number
    await fixDupTopics(educationalElement)
    await db.put('topics', educationalElement)

    if (foundEE.iomHost?.name) {
        if (!foundEE.iomHost.name.includes('Платформа онлайн-обучения Портала')) {
            throw Error('Topic error, Данный элемент не возможно пройти так как данная платформа обучения не поддерживается расширением')
        }
    }

    if (!foundEE.completed && foundEE.status !== 'included') {
        let response = await fetch(`https://${cabinet}.edu.rosminzdrav.ru/api/api/educational-elements/iom/${foundEE.id}/plan`, {
            headers: {authorization: 'Bearer ' + authData.access_token},
            method: 'PUT',
            signal: AbortSignal.any([AbortSignal.timeout(Math.floor(Math.random() * (90000 - 30000) + 30000)), controller.signal])
        })
        if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
        await wait(Math.floor(Math.random() * (10000 - 3000) + 3000))
    } else {
        if (foundEE.completed) console.warn('данный элемент уже пройден пользователем', foundEE)
    }

    let response = await fetch(`https://${cabinet}.edu.rosminzdrav.ru/api/api/educational-elements/iom/${foundEE.id }/open-link?backUrl=https%3A%2F%2F${cabinet}.edu.rosminzdrav.ru%2F%23%2Fuser-account%2Fmy-plan`, {
        headers: {authorization: 'Bearer ' + authData.access_token},
        method: 'GET',
        signal: AbortSignal.any([AbortSignal.timeout(Math.floor(Math.random() * (90000 - 30000) + 30000)), controller.signal])
    })
    if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
    let json = await response.json()
    await checkErrors(json, updatedToken)
    console.log('открываем', educationalElement.name)
    if (!json.url) {
        console.log(json)
        console.log(educationalElement)
        throw Error('Не была получена ссылка по теме ' + educationalElement.name)
    }
    if (!new URL(json.url).host.includes('edu.rosminzdrav.ru')) {
        throw Error('Topic error, Данный элемент не возможно пройти так как данная платформа обучения не поддерживается расширением')
    }
    return json.url
}

async function checkErrors(json, updatedToken) {
    if (json.error) {
        if ((json.error_description?.includes('token expired') || json.error_description?.includes('access token')) && !updatedToken) {
            const authData = await db.get('other', 'authData')
            const cabinet = await db.get('other', 'cabinet')
            if (authData?.refresh_token) {
                const response = await fetch(`https://${cabinet}.edu.rosminzdrav.ru/api/api/v2/oauth/token?grant_type=refresh_token&refresh_token=${authData.refresh_token}`, {
                    headers: {"Content-Type": "application/x-www-form-urlencoded", Authorization: 'Basic ' + btoa(`client:secret`)},
                    method: 'POST',
                    signal: AbortSignal.any([AbortSignal.timeout(Math.floor(Math.random() * (90000 - 30000) + 30000)), controller.signal])
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
    }
}

chrome.tabs.onRemoved.addListener((tabId) => {
    if (runningTab === tabId) {
        console.warn('Работа расширения остановлена, пользователь закрыл вкладку')
        runningTab = null
        collectAnswers = null
        stopRunning = true
        controller.abort()
        chrome.action.setTitle({title: chrome.runtime.getManifest().action.default_title})
        chrome.action.setBadgeText({text: ''})
    }
})

chrome.runtime.onConnect.addListener((port) => {
    // runningTab = port.sender.tab.id
    port.onMessage.addListener(async (message) => {
        await initializeFunc
        if (message.question) {
            let topicKey
            const topic = await db.getFromIndex('topics', 'name', message.question.topics[0])
            if (topic) {
                topicKey = topic.key
                if (topic.needSearchAnswers) {
                    // TODO временно
                    // await searchOn24forcare(message.question.topics[0], topic.key)
                    delete topic.needSearchAnswers
                    await db.put('topics', topic)
                }
            } else {
                topicKey = await db.put('topics', {name: message.question.topics[0]})
                console.log('Внесена новая тема в базу', message.question.topics[0])
                // TODO временно
                // await searchOn24forcare(message.question.topics[0], topicKey)
            }
            const key = await db.getKeyFromIndex('questions', 'question', message.question.question)
            // работа с найденным вопросом
            if (key) {
                const question = await db.get('questions', key)
                const answerHash = objectHash(message.question.answers.answers)
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
                        // if (!question.answers[answerHash].tryedAI) {
                        //     await searchOnAI(question, answerHash)
                        //     if (question.correctAnswers[answerHash]) {
                        //         answers = question.correctAnswers[answerHash]
                        //     }
                        // }
                        console.log('добавлены новые варианты ответов', question)
                    }
                    question.answers[answerHash].lastUsedAnswers = answers
                    port.postMessage({answers, question})
                // если найден и вопрос и к нему вариант ответов
                } else {
                    if (!question.lastOrder) question.lastOrder = {}
                    question.lastOrder[message.question.lastOrder] = answerHash
                    if (!question.answers[answerHash].type && message.question.answers.type) {
                        question.answers[answerHash].type = message.question.answers.type
                    }
                    // отправляем правильный ответ если он есть
                    if (question.correctAnswers[answerHash]?.length) {
                        console.log('отправлен ответ', question)
                        port.postMessage({answers: question.correctAnswers[answerHash], question, correct: true})
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
                        // if (!question.answers[answerHash].tryedAI) {
                        //     await searchOnAI(question, answerHash)
                        //     if (question.correctAnswers[answerHash]) {
                        //         answers = question.correctAnswers[answerHash]
                        //     }
                        // }
                        question.answers[answerHash].lastUsedAnswers = answers
                        port.postMessage({answers, question})
                    }
                }
                if (!question.topics.includes(topicKey)) {
                    question.topics.push(topicKey)
                }
                await db.put('questions', question, key)
            // добавление вопроса с его вариантами ответов
            } else {
                const question = message.question
                const multi = question.answers.type.toLowerCase().includes('несколько')
                question.answers.combinations = getCombinations(Array.from(question.answers.answers.keys()), multi)
                const combination = question.answers.combinations[Math.floor(Math.random()*question.answers.combinations.length)]
                let answers = combination.map(index => question.answers.answers[index])
                const answerHash = objectHash(question.answers.answers)
                question.answers = {[answerHash]: question.answers}
                question.lastOrder = {[question.lastOrder]: answerHash}
                question.correctAnswers = {}
                question.topics = [topicKey]
                console.log('добавлен новый вопрос', question)
                // await searchOnAI(question, answerHash)
                // if (question.correctAnswers[answerHash]) {
                //     answers = question.correctAnswers[answerHash]
                // }
                question.answers[answerHash].lastUsedAnswers = answers
                port.postMessage({answers, question})
                await db.put('questions', question)
            }
        // сохранение результатов теста с правильными и не правильными ответами
        } else if (message.results) {
            let stats = {correct: 0, taken: 0, ignored: 0}
            for (const resultQuestion of message.results) {
                let topicKey = await db.getKeyFromIndex('topics', 'name', resultQuestion.topics[0])
                if (!topicKey) {
                    topicKey = await db.put('topics', {name: resultQuestion.topics[0]})
                    console.log('Внесена новая тема в базу', resultQuestion.topics[0])
                    // await searchOn24forcare(resultQuestion.topics[0], topicKey)
                }
                let key = await db.getKeyFromIndex('questions', 'question', resultQuestion.question)
                // если мы получили ответ, но в бд его нет, сохраняем если этот ответ правильный
                if (!key) {
                    if (resultQuestion.correct) {
                        const correctQuestion = {
                            question: resultQuestion.question,
                            answers: {},
                            topics: [topicKey],
                            correctAnswers: {'unknown': resultQuestion.answers.answers}
                        }
                        key = await db.put('questions', correctQuestion)
                        console.log('записан новый ответ с новым вопросом', correctQuestion)
                        stats.correct++
                    } else {
                        console.log('пропущено', resultQuestion)
                        stats.ignored++
                    }
                // сохраняем правильный ответ или учитываем не правильный ответ
                } else {
                    const question = await db.get('questions', key)
                    let changedCombinations = false
                    let changedAnswers = false
                    let notAnswered = false
                    const foundAnswerHash = question.lastOrder?.[resultQuestion.lastOrder]
                    // если ответ правильный, сохраняем правильные ответы, и удаляем combinations находя по ответам нужный вариант ответов
                    if (resultQuestion.answers.answers?.length && resultQuestion.correct) {
                        const searchAnswers = foundAnswerHash ? [foundAnswerHash] : Object.keys(question.answers)
                        const matchAnswers = []
                        for (const answerHash of searchAnswers) {
                            let wrongVariant = false
                            if (question.answers[answerHash].type && Boolean(resultQuestion.answers.type?.toLowerCase?.()?.includes?.('несколько')) !== question.answers[answerHash].type.toLowerCase().includes('несколько')) {
                                wrongVariant = true
                            }

                            for (const answer of resultQuestion.answers.answers) {
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
                            question.correctAnswers['unknown'] = Array.from(new Set(question.correctAnswers['unknown'].concat(resultQuestion.answers.answers)))
                            changedAnswers = oldAnswers !== JSON.stringify(question.correctAnswers)
                            stats.taken++
                        } else {
                            let fakeCorrectAnswers = false
                            if (question.correctAnswers[matchAnswers[0]]) {
                                if (JSON.stringify(question.correctAnswers[matchAnswers[0]]) !== JSON.stringify(resultQuestion.answers.answers)) {
                                    if (!question.answers[matchAnswers[0]].fakeCorrectAnswers) {
                                        fakeCorrectAnswers = true
                                        changedCombinations = true
                                        question.answers[matchAnswers[0]].fakeCorrectAnswers = true
                                        console.warn('Результат с правильными ответами не соответствует с бд, в бд были не правильные ответы? Возможно это сбой какой-то', question, resultQuestion, JSON.stringify(question.correctAnswers[matchAnswers[0]]), JSON.stringify(resultQuestion.answers.answers))
                                    } else {
                                        console.warn('Результат с правильными ответами не соответствует с бд, в бд были не правильные ответы? Были перезаписаны правильные ответы', question, resultQuestion, JSON.stringify(question.correctAnswers[matchAnswers[0]]), JSON.stringify(resultQuestion.answers.answers))
                                        changedAnswers = true
                                        question.correctAnswers[matchAnswers[0]] = resultQuestion.answers.answers
                                    }
                                    stats.taken++
                                } else {
                                    stats.ignored++
                                }
                            } else {
                                changedAnswers = true
                                question.correctAnswers[matchAnswers[0]] = resultQuestion.answers.answers
                                stats.correct++
                            }
                            if (question.answers[matchAnswers[0]].combinations) {
                                changedCombinations = true
                                delete question.answers[matchAnswers[0]].combinations
                            }
                            if (question.correctAnswers['unknown']) {
                                for (const answer of resultQuestion.answers.answers) {
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
                    } else if (resultQuestion.answers.answers?.length) {
                        const searchAnswers = foundAnswerHash ? [foundAnswerHash] : Object.keys(question.answers)
                        let fakeCorrectAnswers = false
                        // если у нас есть правильный ответ, но мы получили что этот ответ НЕ правильный, то значит у нас в бд неверные данные, удаляем ответ и генерируем комбинации для подбора ответа
                        if (question.correctAnswers[foundAnswerHash]) {
                            if (JSON.stringify(question.correctAnswers[foundAnswerHash]) !== JSON.stringify(resultQuestion.answers.answers)) {
                                console.warn('На вопрос были даны НЕ правильные ответы не смотря на то что в бд есть ПРАВИЛЬНЫЕ ответы', JSON.stringify(question.correctAnswers[foundAnswerHash]), JSON.stringify(resultQuestion.answers.answers), question)
                            } else {
                                // TODO иногда какого-то хрена правильные ответы выдаются как неверные, мы пробуем костылём во второй раз ответить
                                //  но если и во второй раз не прокатит то удаляем правилные ответы и пробуем методом подбора подобрать правильные ответы
                                if (!question.answers[foundAnswerHash].fakeCorrectAnswers && !question.answers[foundAnswerHash].tryedAI) {
                                    console.warn('Пока какой-то причине НМО посчитал правильные ответы НЕ правильными, возможно это сбой какой-то', question, resultQuestion)
                                    changedCombinations = true
                                    fakeCorrectAnswers = true
                                    question.answers[foundAnswerHash].fakeCorrectAnswers = true
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
                            for (const answer of resultQuestion.answers.answers) {
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
                        changedCombinations = true
                        delete question.lastOrder?.[resultQuestion.lastOrder]
                        if (!notAnswered) delete question.answers[foundAnswerHash].lastUsedAnswers

                        if (!question.topics.includes(topicKey)) {
                            question.topics.push(topicKey)
                        }
                    }

                    if (changedAnswers || changedCombinations) {
                        await db.put('questions', question, key)
                        if (changedAnswers) {
                            console.log('записан или изменён новый ответ', resultQuestion, question)
                        } else {
                            // пока что ничего
                        }
                    }
                }
            }
            port.postMessage({stats})
        } else if (message.running != null || message.collectAnswers != null) {
            if (message.running || message.collectAnswers) {
                if (message.collectAnswers) collectAnswers = message.collectAnswers
                runningTab = port.sender.tab.id
                // chrome.action.setBadgeText({text: 'ON'})
            }
        } else if (message.done) {
            const educationalElement = await db.getFromIndex('topics', 'name', message.topic)
            console.log('закончено', message.topic)
            if (educationalElement) {
                if (message.error) {
                    showNotification('Предупреждение', message.error)
                    educationalElement.completed = 2
                    educationalElement.error = message.error
                } else {
                    // TODO временно
                    // educationalElement.completed = 1
                    delete educationalElement.completed
                }
                await db.put('topics', educationalElement)
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
    })

    self.port = port
})

self.fixDupTopics = fixDupTopics
async function fixDupTopics(educationalElement) {
    const transaction = db.transaction(['questions', 'topics'], 'readwrite')
    if (educationalElement.name) {
        let cursor = await transaction.objectStore('topics').index('name').openCursor(educationalElement.name)
        while (cursor) {
            if (educationalElement.key !== cursor.value.key) {
                console.warn('Найден дублирующий topic, для исправления он был удалён', cursor.value)
                let count = 0
                let cursor2 = await transaction.objectStore('questions').index('topics').openCursor(cursor.value.key)
                while(cursor2) {
                    count++
                    const question = cursor2.value
                    question.topics.splice(question.topics.indexOf(cursor.value.key), 1)
                    if (!question.topics.includes(educationalElement.key)) {
                        question.topics.push(educationalElement.key)
                    }
                    await cursor2.update(question)
                    // noinspection JSVoidFunctionReturnValueUsed
                    cursor2 = await cursor2.continue()
                }
                if (count) {
                    console.warn('Key topic\'а был заменён в следующих кол-во тем', count)
                }
                await cursor.delete()
            }
            // noinspection JSVoidFunctionReturnValueUsed
            cursor = await cursor.continue()
        }
    }
}

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

self.searchOnAI = searchOnAI
async function searchOnAI(question, answerHash) {
    try {
        console.log('Спрашивает ответ у ИИ')
        // TODO временно
        if (!answerHash) answerHash = Object.keys(question.answers)
        let type = question.answers[answerHash].type
        if (!type) type = 'Выберите ОДИН правильный ответ'
        let content = 'Вопрос: ' + question.question + '\n\n' + type + ':\n- ' + question.answers[answerHash].answers.join('\n- ')
        let response = await fetch(' https://api.groq.com/openai/v1/chat/completions', {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer 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'
            },
            body: JSON.stringify({
                model: 'llama-3.1-70b-versatile',
                messages: [
                    {role: 'system', content: 'Ты должен отвечать только из предложенных вариантов ответов с новой строки без лишних слов'},
                    {role: 'user', content},
                ]
            }),
            method: 'POST',
            signal: AbortSignal.any([AbortSignal.timeout(Math.floor(Math.random() * (90000 - 30000) + 30000)), controller.signal])
        })
        let json = await response.json()
        console.log('Ответ от ИИ получен\n', json.choices[0].message.content)

        const correctAnswers = json.choices[0].message.content.split('\n').map(item => item.replace(/- /, '').trim())
        for (const answer of correctAnswers) {
            if (!question.answers[answerHash].answers.includes(answer)) {
                console.warn('Ответы которые дал ИИ не соответствует предложенным вариантам ответов')
                return
            }
        }

        question.answers[answerHash].tryedAI = true
        question.correctAnswers[answerHash] = correctAnswers
    } catch (error) {
        console.error('Ошибка с ИИ', error)
    }
}

self.searchOn24forcare = searchOn24forcare
async function searchOn24forcare(topic, topicKey) {
    chrome.action.setTitle({title: 'Выполняется поиск ответов в интернете'})
    chrome.action.setBadgeText({text: 'SEARCH'})
    // const origNameTopic = topic
    try {
        console.log('Поиск ответов на сайте 24forcare.com по теме ' + topic + '...')
        // c " на сайте плохо ищется
        topic = topic.replaceAll(/["«»]/gi, '')
        let response = await fetch('https://24forcare.com/search/?query=' + topic, {signal: controller.signal})
        let text = await response.text()
        let doc = new JSDOM(text).window.document
        let shot = true
        if (!doc.querySelector('.item-name') && topic.match(/\s?-?\s?\d{4}$/gi)) {
            shot = false
            topic = topic.replaceAll(/\s?-?\s?\d{4}$/gi, '')
            response = await fetch('https://24forcare.com/search/?query=' + topic, {signal: controller.signal})
            text = await response.text()
            doc = new JSDOM(text).window.document
        }
        if (!doc.querySelector('.item-name') && topic.includes('клиническим рекомендациям') && topic.lastIndexOf('(') !== -1) {
            shot = false
            topic = topic.slice(0, topic.lastIndexOf('(')).trim()
            response = await fetch('https://24forcare.com/search/?query=' + topic, {signal: controller.signal})
            text = await response.text()
            doc = new JSDOM(text).window.document
        }
        if (!doc.querySelector('.item-name')) {
            shot = true
            response = await fetch('https://24forcare.com/search/?query=' + topic.substring(0, topic.length / 2), {signal: controller.signal})
            text = await response.text()
            doc = new JSDOM(text).window.document
        }
        if (!doc.querySelector('.item-name')) {
            console.warn('На сайте 24forcare.com не удалось найти ответы по теме ' + topic)
            return
        }
        const searchTopics = doc.querySelector('.shot') && shot ? doc.querySelectorAll('.shot') : doc.querySelectorAll('.item-name')
        for (const found of searchTopics) {
            const response2 = await fetch(found.href, {signal: controller.signal})
            const text2 = await response2.text()
            const doc2 = new JSDOM(text2).window.document
            let topicText = normalizeText(doc2.querySelector('h1').textContent)
            // if (topicText.startsWith('Тест с ответами по теме «')) {
            //     topicText = topicText.replaceAll('Тест с ответами по теме «', '')
            //     topicText = topicText.slice(0, -1)
            // }
            console.log('Найдено ' + topicText)
            for (const el of doc2.querySelectorAll('.row h3')) {
                // noinspection JSDeprecatedSymbols
                if (el.querySelector('tt') || el.querySelector('em')) continue // обрезаем всякую рекламу
                const questionText = normalizeText(el.textContent.trim().replace(/^\d+\.\s*/, ''))
                const key = await db.getKeyFromIndex('questions', 'question', questionText)
                let question = {answers: {}, correctAnswers: {}}
                if (key) {
                    question = await db.get('questions', key)
                }
                const answers = []
                const correctAnswers = []
                for (const answer of el.nextElementSibling.childNodes) {
                    if (!answer.textContent.trim()) continue
                    // noinspection RegExpRedundantEscape
                    const text = normalizeText(answer.textContent).replaceAll(/^"/g, '').replaceAll(/^\d+\) /g, '').replaceAll(/[\.\;\+"]+$/g, '')
                    if (answer.tagName === 'STRONG') {
                        correctAnswers.push(text)
                    }
                    answers.push(text)
                }
                if (!answers.length || !correctAnswers.length) continue
                answers.sort()
                correctAnswers.sort()
                const answersHash = objectHash(answers)
                let changed = false
                if (!question.answers[answersHash]) {
                    changed = true
                    question.answers[answersHash] = {answers}
                } else if (question.answers[answersHash].combinations) {
                    changed = true
                    delete question.answers[answersHash].combinations
                }
                if (!question.correctAnswers[answersHash]) {
                    changed = true
                    question.correctAnswers[answersHash] = correctAnswers
                }
                if (question.correctAnswers['unknown']) {
                    for (const answer of correctAnswers) {
                        const index = question.correctAnswers['unknown'].indexOf(answer)
                        if (index !== -1) {
                            changed = true
                            question.correctAnswers['unknown'].splice(index, 1)
                        }
                    }
                }
                if (question.correctAnswers['unknown']?.length === 0) {
                    delete question.correctAnswers['unknown']
                }
                if (question.topics && !question.topics.includes(topicKey)) {
                    question.topics.push(topicKey)
                }
                if (!key) {
                    changed = true
                    question.question = questionText
                    question.topics = [topicKey]
                }
                if (changed) {
                    console.log('С сайта 24forcare.com добавлены или изменены ответы в бд', question)
                    await db.put('questions', question, key)
                }
            }
        }
        console.log('Поиск ответов на сайте 24forcare.com по теме ' + topic + ' окончен')
    } catch (error) {
        console.error('Ошибка поиска ответов на сайте 24forcare.com', error)
    } finally {
        if (!stopRunning) {
            chrome.action.setTitle({title: 'Расширение решает тест'})
            chrome.action.setBadgeText({text: 'ON'})
        }
    }
}

function showNotification(title, message) {
    console.log(title, message)
    chrome.action.setTitle({title: message})
    chrome.notifications.create({type: 'basic', message, title, iconUrl: 'icon.png'})
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// тупорылый костыль (официально одобренный самим гуглом) на то что б Service Worker не отключался во время выполнения кода
async function waitUntil(promise) {
    const keepAlive = setInterval(chrome.runtime.getPlatformInfo, 25 * 1000)
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
            timerKeepAlive = setInterval(chrome.runtime.getPlatformInfo, 25 * 1000)
        }
    } else {
        clearInterval(timerKeepAlive)
        timerKeepAlive = null
    }
}
