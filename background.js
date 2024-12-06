import { openDB } from '/libs/idb.js';
import { default as objectHash } from '/libs/object-hash.js';
import { JSDOM } from '/libs/jsdom.js';

self.JSDOM = JSDOM // TODO для меньшей нагрузки следует эту реализацию заменить на API chrome.offscreen (ну и говно-код же получится с его использованием)
self.objectHash = objectHash

let db
let runningTab
let stopRunning = false
let collectAnswers = 0
let reloaded = 0

let firstInit = false
const initializeFunc = init()
initializeFunc.finally(() => initializeFunc.done = true)
async function init() {
    // noinspection JSUnusedGlobalSymbols
    db = await openDB('nmo', 3, {upgrade})
    // noinspection JSUnusedLocalSymbols
    async function upgrade(db, oldVersion, newVersion, transaction) {
        if (oldVersion !== newVersion) {
            console.log('Обновление базы данных с версии ' + oldVersion + ' на ' + newVersion)
        }

        if (oldVersion === 0) {
            firstInit = true
            const questions = db.createObjectStore('questions', {autoIncrement: true})
            questions.createIndex('question', 'question')
            const educationalElements = db.createObjectStore('educational-elements', {autoIncrement: true})
            educationalElements.createIndex('name', 'name')
            const topics = db.createObjectStore('topics', {autoIncrement: true, keyPath: 'key'})
            topics.createIndex('name', 'name')
            topics.createIndex('needComplete', 'needComplete')
            topics.createIndex('code', 'code')
            db.createObjectStore('other')
            return
        }

        if (oldVersion <= 1) {
            console.log('Этап обновления с версии 1 на 2')
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

        if (oldVersion <= 2) {
            console.log('Этап обновления с версии 2 на 3')
            db.deleteObjectStore('topics')
            const topics = db.createObjectStore('topics', {autoIncrement: true, keyPath: 'key'})
            topics.createIndex('name', 'name')
            topics.createIndex('needComplete', 'needComplete')
            topics.createIndex('code', 'code')

            let cursor = await transaction.objectStore('questions').openCursor()
            while (cursor) {
                const question = cursor.value
                if (question.topics.length) {
                    for (const [index, topic] of question.topics.entries()) {
                        let key = await transaction.objectStore('topics').index('name').getKey(topic)
                        if (key == null) {
                            key = await transaction.objectStore('topics').put({name: topic})
                        }
                        question.topics[index] = key
                    }
                    await cursor.update(question)
                }
                // noinspection JSVoidFunctionReturnValueUsed
                cursor = await cursor.continue()
            }
        }
    }
    self.db = db  // TODO временно
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

        reimportEducationElements()
    }
    console.log('started background!')
}

self.addEventListener('install', () => {
    chrome.contextMenus.create({
        id: 'download',
        title: 'Скачать базу данных',
        contexts: ['action']
    })
    chrome.contextMenus.onClicked.addListener((info) => {
        if (!initializeFunc.done) {
            chrome.notifications.create('warn', {
                type: 'basic',
                message: 'Идёт инициализация базы данных, подождите',
                title: 'Подождите',
                iconUrl: 'icon.png'
            })
            return
        }
        if (info.menuItemId === 'download') {
            chrome.tabs.create({url: 'options/options.html'})
        }
    })
})

self.reimportEducationElements = reimportEducationElements
async function reimportEducationElements() {
    await db.clear('educational-elements')
    const response = await fetch(chrome.runtime.getURL('data/educational-elements.txt'))
    const text = await response.text()
    const transaction = db.transaction('educational-elements', 'readwrite').objectStore('educational-elements')
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
                object.name = ee[0].trim()
            }
        } else if (ee[0]?.trim() && ee[1]?.trim()) {
            object.code = ee[0].trim()
            object.name = ee[1].trim()
        }
        await transaction.add(object)
    }
}

// self.searchDupQuestions = searchDupQuestions
// async function searchDupQuestions() {
//     let transaction = db.transaction('questions').objectStore('questions')
//     let cursor = await transaction.openCursor()
//     while (cursor) {
//         const count = await transaction.index('question').count(cursor.value.question)
//         if (count > 1) {
//             console.warn('Найден дубликат', cursor.value.question)
//         }
//         // noinspection JSVoidFunctionReturnValueUsed
//         cursor = await cursor.continue()
//     }
// }

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
                    question.push(newTopicKey)
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.text === 'get_status') {
        sendResponse({running: runningTab === sender.tab.id, collectAnswers: collectAnswers})
        if (message.authData) {
            (async () => {
                await initializeFunc
                await db.put('other', message.authData, 'authData')
            })()
        }
    }
})

chrome.action.onClicked.addListener((tab) => {
    if (!initializeFunc.done) {
        chrome.notifications.create('warn', {type: 'basic', message: 'Идёт инициализация базы данных, подождите', title: 'Подождите', iconUrl: 'icon.png'})
        return
    }
    chrome.tabs.sendMessage(tab.id, {text: 'get_status'}, async (msg) => {
        const error = chrome.runtime.lastError?.message
        if (error) {
            if (!error.includes('Receiving end does not exist')) {
                console.error(error)
                chrome.action.setBadgeText({text: 'ERR'})
            }
            return
        }
        if (msg.running) {
            runningTab = tab.id
            chrome.action.setBadgeText({text: 'ON'})
            chrome.tabs.sendMessage(tab.id, {text: 'stop'}, (msg) => chrome.action.setBadgeText({text: msg.running ? 'ON' : ''}))
        } else if (runningTab) {
            stopRunning = true
            chrome.tabs.sendMessage(runningTab, {text: 'stop'}, (msg) => chrome.action.setBadgeText({text: msg.running ? 'ON' : ''}))
        } else {
            checkOrGetEducationElements({tabId: tab.id})
        }
    })
    // chrome.tabs.sendMessage(tab.id, {text: 'change_status'}, (msg) => {
    //     const error = chrome.runtime.lastError?.message
    //     if (error && !error.includes('Receiving end does not exist')) {
    //         console.error(error)
    //         chrome.action.setBadgeText({text: 'ERR'})
    //     }
    //     if (msg?.running) {
    //         runningTab = tab.id
    //         chrome.action.setBadgeText({text: 'ON'})
    //     } else {
    //         if (runningTab) {
    //             chrome.tabs.sendMessage(runningTab, {text: 'stop'})
    //         }
    //         runningTab = null
    //         collectAnswers = null
    //         stopRunning = false
    //         chrome.action.setBadgeText({text: ''})
    //     }
    // })
})

let attemptsGetEducation = 0
async function checkOrGetEducationElements(parameters) {
    if (stopRunning) {
        chrome.tabs.sendMessage(runningTab, {text: 'stop'}, (msg) => chrome.action.setBadgeText({text: msg.running ? 'ON' : ''}))
        return
    }
    chrome.action.setBadgeText({text: 'ON'})
    await initializeFunc
    reloaded = 0
    try {
        let countEE = await db.count('educational-elements')
        if (countEE && parameters.topic) {
            const key = await db.getKeyFromIndex('educational-elements', 'name', parameters.topic)
            if (key) {
                console.log('решено', parameters.topic)
                await db.delete('educational-elements', key)
                parameters.topic = null
                countEE = await db.count('educational-elements')
            } else {
                console.warn('Название темы не найдено', parameters.topic)
            }
        }
        if (countEE) {
            const cursor = await db.transaction('educational-elements').store.openCursor()
            let educationalElement = cursor.value
            if (parameters.cut) {
                educationalElement.name = educationalElement.name.slice(0, -10)
                console.log('ищем (урезанное название)', educationalElement)
            } else {
                console.log('ищем', educationalElement)
            }

            const authData = await db.get('other', 'authData')
            if (!authData?.access_token) {
                throw Error('Нет данных авторизации')
            }

            let elementId
            let elementName
            let completed
            let status
            if (!educationalElement.id) {
                let response = await fetch('https://nmfo-vo.edu.rosminzdrav.ru/api/api/educational-elements/search', {
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
                    signal: AbortSignal.timeout(60000)
                })
                if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
                let json = await response.json()
                if (!await checkErrors(json, parameters)) return
                if (!json?.elements?.length) {
                    if (parameters.cut) {
                        console.log(json)
                        throw Error('По названию ' + educationalElement.name + ' ничего не найдено')
                    } else {
                        parameters.cut = true
                        checkOrGetEducationElements(parameters)
                        return
                    }
                }
                for (const element of json.elements) {
                    response = await fetch('https://nmfo-vo.edu.rosminzdrav.ru/api/api/educational-elements/iom/' + element.elementId + '/', {
                        headers: {authorization: 'Bearer ' + authData.access_token},
                        method: 'GET',
                        signal: AbortSignal.timeout(60000)
                    })
                    if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
                    let json2 = await response.json()
                    if (!await checkErrors(json2, parameters)) return
                    if (educationalElement.code) {
                        if (educationalElement.code === json2.number) {
                            if (json2.iomHost?.name) {
                                if (!json2.iomHost.name.includes('Платформа онлайн-обучения Портала')) {
                                    console.warn('Данный элемент не возможно пройти так как платформа там другая', educationalElement)
                                    await db.delete('educational-elements', cursor.key)
                                    checkOrGetEducationElements(parameters)
                                    return
                                }
                            }
                            elementId = element.elementId
                            elementName = json2.name.trim()
                            completed = json2.completed
                            status = json2.status
                            break
                        }
                    } else if (json.elements.length > 1) {
                        console.log(json2.elements)
                        throw  Error('По названию ' + educationalElement.name + ' найдено больше одного элемента (а ожидалось 1)')
                    } else {
                        elementId = element.elementId
                        elementName = json2.name.trim()
                        completed = json2.completed
                        status = json2.status
                    }
                }
                if (!elementId) {
                    console.log(json.elements)
                    throw Error('По названию ' + educationalElement.name + ' ничего не найдено, но есть результаты')
                } else {
                    if (educationalElement.name !== elementName) {
                        console.warn('Названия не соответствуют:')
                        console.warn(educationalElement.name)
                        console.warn(elementName)
                    }
                    educationalElement.id = elementId
                    educationalElement.name = elementName
                    await db.put('educational-elements', educationalElement, cursor.key)
                }
            } else {
                elementId = educationalElement.id
                let response = await fetch('https://nmfo-vo.edu.rosminzdrav.ru/api/api/educational-elements/iom/' + elementId + '/', {
                    headers: {authorization: 'Bearer ' + authData.access_token},
                    method: 'GET',
                    signal: AbortSignal.timeout(60000)
                })
                if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
                let json2 = await response.json()
                if (!await checkErrors(json2, parameters)) return
                if (json2.iomHost?.name) {
                    if (!json2.iomHost.name.includes('Платформа онлайн-обучения Портала')) {
                        console.warn('Данный элемент не возможно пройти так как платформа там другая', educationalElement)
                        await db.delete('educational-elements', cursor.key)
                        checkOrGetEducationElements(parameters)
                        return
                    }
                }
                if (!educationalElement.name) {
                    educationalElement.name = json2.name.trim()
                    await db.put('educational-elements', educationalElement, cursor.key)
                }
                elementName = json2.name.trim()
                completed = json2.completed
                status = json2.status
            }

            if (!completed && status !== 'included') {
                let response = await fetch('https://nmfo-vo.edu.rosminzdrav.ru/api/api/educational-elements/iom/' + elementId + '/plan', {
                    headers: {authorization: 'Bearer ' + authData.access_token},
                    method: 'PUT',
                    signal: AbortSignal.timeout(60000)
                })
                if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
                await wait(Math.floor(Math.random() * (10000 - 3000) + 3000))
            } else {
                if (completed) console.warn('данный элемент уже пройден пользователем ' + elementName)
            }

            let count = 0
            let json
            while (count <= 5) {
                count = count + 1
                let response = await fetch('https://nmfo-vo.edu.rosminzdrav.ru/api/api/educational-elements/iom/' + elementId + '/open-link?backUrl=https%3A%2F%2Fnmfo-vo.edu.rosminzdrav.ru%2F%23%2Fuser-account%2Fmy-plan', {
                    headers: {authorization: 'Bearer ' + authData.access_token},
                    method: 'GET',
                    signal: AbortSignal.timeout(60000)
                })
                if (!response.ok && String(response.status).startsWith('5')) throw Error('bad code ' + response.status)
                json = await response.json()
                if (!await checkErrors(json, parameters)) return
                if (json.url) break
                await wait(Math.floor(Math.random() * (10000 - 3000) + 3000))
            }
            console.log('открываем', educationalElement.name)
            if (!json.url) {
                console.log(json)
                console.log(educationalElement)
                throw Error('Не была получена ссылка по теме ' + educationalElement.name)
            }
            runningTab = parameters.tabId
            chrome.action.setBadgeText({text: 'ON'})
            chrome.tabs.sendMessage(parameters.tabId, {text: 'open_url', url: json.url})
            attemptsGetEducation = 0
        } else if (parameters.done) {
            chrome.tabs.sendMessage(parameters.tabId, {text: 'stop'}, (msg) => chrome.action.setBadgeText({text: msg.running ? 'ON' : ''}))
            console.log('Расширение окончил работу')
            chrome.notifications.create('done', {type: 'basic', message: 'Расширение окончил работу', title: 'Готово', iconUrl: 'icon.png'})
        } else {
            chrome.tabs.sendMessage(parameters.tabId, {text: 'start'}, (msg) => chrome.action.setBadgeText({text: msg.running ? 'ON' : ''}))
        }
    } catch (error) {
        if ((error.message === 'signal timed out' || error.message.includes('bad code 5')) && attemptsGetEducation <= 15) {
            attemptsGetEducation++
            await wait(Math.floor(Math.random() * (10000 - 3000) + 3000))
            checkOrGetEducationElements(parameters)
            return
        }
        chrome.tabs.sendMessage(parameters.tabId, {text: 'stop'}, (msg) => chrome.action.setBadgeText({text: msg.running ? 'ON' : ''}))
        console.error(error)
        chrome.notifications.create('error', {type: 'basic', message: error.message, title: 'Ошибка', iconUrl: 'icon.png'})
        if (!runningTab) {
            chrome.action.setBadgeText({text: ''})
        }
    }
}

async function checkErrors(json, parameters) {
    if (json.error) {
        if ((json.error_description?.includes('token expired') || json.error_description?.includes('access token')) && !parameters.updatedToken) {
            const authData = await db.get('other', 'authData')
            if (authData?.refresh_token) {
                const response = await fetch('https://nmfo-vo.edu.rosminzdrav.ru/api/api/v2/oauth/token?grant_type=refresh_token&refresh_token=' + authData.refresh_token, {
                    headers: {"Content-Type": "application/x-www-form-urlencoded", Authorization: 'Basic ' + btoa(`client:secret`)},
                    method: 'POST',
                    signal: AbortSignal.timeout(60000)
                })
                const json2 = await response.json()
                console.log(json2)
                if (json2?.access_token) {
                    await db.put('other', json2, 'authData')
                } else {
                    console.error('Не удалось обновить access_token')
                    throw Error('Не удалось обновить access_token ' + JSON.stringify(json2).slice(0, 150))
                }
                parameters.updatedToken = true
                checkOrGetEducationElements(parameters)
                return false
            }
        }
        console.log(json)
        throw Error('НМО выдал ошибку при попытке поиска ' + JSON.stringify(json).slice(0, 150))
    }
    return true
}

chrome.tabs.onRemoved.addListener((tabId) => {
    if (runningTab === tabId) {
        runningTab = null
        collectAnswers = null
        stopRunning = false
        chrome.action.setBadgeText({text: ''})
    }
})

let pingPongTimer
chrome.runtime.onConnect.addListener((port) => {
    runningTab = port.sender.tab.id
    port.onMessage.addListener(async (message) => {
        await initializeFunc
        if (message.question) {
            let topicKey = await db.getKeyFromIndex('topics', 'name', message.question.topics[0])
            if (!topicKey) {
                topicKey = await db.put('topics', {name: message.question.topics[0]})
                console.log('Внесена новая тема в базу', message.question.topics[0])
                await searchOn24forcare(message.question.topics[0], topicKey)
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
                        for (const correctAnswers of Object.values(question.correctAnswers)) answers = answers.concat(correctAnswers)
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
                    port.postMessage(answers)
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
                        port.postMessage(question.correctAnswers[answerHash])
                    // если нет правильных ответов, предлагаем рандомный предполагаемый вариант правильного ответа
                    } else {
                        let combination = question.answers[answerHash].combinations?.[Math.floor(Math.random()*question.answers[answerHash].combinations?.length)]
                        let answers = []
                        if (combination?.length) {
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
                                for (const correctAnswers of Object.values(question.correctAnswers)) answers = answers.concat(correctAnswers)
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
                        port.postMessage(answers)
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
                console.log('добавлен новый вопрос', question)
                // await searchOnAI(question, answerHash)
                // if (question.correctAnswers[answerHash]) {
                //     answers = question.correctAnswers[answerHash]
                // }
                port.postMessage(answers)
                await db.put('questions', question)
            }
        // сохранение результатов теста с правильными и не правильными ответами
        } else if (message.results) {
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
                    } else {
                        console.log('пропущено', resultQuestion)
                    }
                // сохраняем правильный ответ или учитываем не правильный ответ
                } else {
                    const question = await db.get('questions', key)
                    let changedCombinations = false
                    let changedAnswers = false
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
                        } else if (!matchAnswers.length) {
                            const oldAnswers = JSON.stringify(question.correctAnswers['unknown'])
                            if (!question.correctAnswers['unknown']) question.correctAnswers['unknown'] = []
                            question.correctAnswers['unknown'] = Array.from(new Set(question.correctAnswers['unknown'].concat(resultQuestion.answers.answers)))
                            changedAnswers = oldAnswers !== JSON.stringify(question.correctAnswers)
                        } else {
                            if (question.correctAnswers[matchAnswers[0]]) {
                                if (JSON.stringify(question.correctAnswers[matchAnswers[0]]) !== JSON.stringify(resultQuestion.answers.answers)) {
                                    console.warn('Результат с правильными ответами не соответствует с бд, в бд были не правильные ответы?', question, resultQuestion, JSON.stringify(question.correctAnswers[matchAnswers[0]]), JSON.stringify(resultQuestion.answers.answers))
                                    changedAnswers = true
                                    question.correctAnswers[matchAnswers[0]] = resultQuestion.answers.answers
                                }
                            } else {
                                changedAnswers = true
                                question.correctAnswers[matchAnswers[0]] = resultQuestion.answers.answers
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
                            if (question.answers[matchAnswers[0]].fakeCorrectAnswers) {
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
                        } else if (!matchAnswers.length) {
                            if (foundAnswerHash) {
                                // TODO возможно тут следует заново генерировать комбинации, правда это чревато цикличным подбором ответов
                                console.warn('пропущено, не найдена комбинация по заданному lastOrder', resultQuestion, question, question.lastOrder)
                            } else {
                                console.warn('пропущено, не найдена комбинация', resultQuestion, question)
                            }
                        } else if (!fakeCorrectAnswers) {
                            // удаляем ту комбинацию которая была использована при попытке
                            changedCombinations = true
                            question.answers[matchAnswers[0].answerHash].combinations.splice(matchAnswers[0].index, 1)
                        }
                    } else {
                        // console.warn('пропущено, не предоставлены ответы', resultQuestion)
                        console.log('пропущено, не предоставлены ответы', resultQuestion, question)
                    }
                    if (foundAnswerHash) {
                        changedCombinations = true
                        delete question.lastOrder[resultQuestion.lastOrder]

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
        } else if (message.running != null || message.collectAnswers != null) {
            if (message.running || message.collectAnswers) {
                if (message.collectAnswers) collectAnswers = message.collectAnswers
                runningTab = port.sender.tab.id
                chrome.action.setBadgeText({text: 'ON'})
            } else {
                if (message.error) {
                    console.error(message.error)
                    chrome.notifications.create('done', {type: 'basic', message: message.error, title: 'Ошибка', iconUrl: 'icon.png'})
                }
                runningTab = null
                collectAnswers = null
                stopRunning = false
                chrome.action.setBadgeText({text: ''})
            }
        } else if (message.done) {
            // chrome.notifications.create('done', {type: 'basic', message: 'Расширение окончил работу', title: 'Готово', iconUrl: 'icon.png'})
            if (message.error) {
                console.warn('По теме ' + message.topic + ' есть ошибка: ' + message.error)
            }
            checkOrGetEducationElements({tabId: runningTab, topic: message.topic, done: true})
            // setTimeout(() => {
            // chrome.notifications.clear('done')
            // }, 9000)
        } else if (message.reloaded) {
            reloaded++
            if (reloaded >= 50) {
                chrome.tabs.sendMessage(runningTab, {text: 'stop'}, (msg) => chrome.action.setBadgeText({text: msg.running ? 'ON' : ''}))
                console.error('Слишком много попыток перезагрузить страницу')
                chrome.notifications.create('done', {
                    type: 'basic',
                    message: 'Слишком много попыток перезагрузить страницу',
                    title: 'Ошибка',
                    iconUrl: 'icon.png'
                })
            }
        } else if (message.pong) {
            // none
        } else {
            console.warn(message)
        }
    })
    if (stopRunning) {
        chrome.tabs.sendMessage(runningTab, {text: 'stop'}, (msg) => chrome.action.setBadgeText({text: msg.running ? 'ON' : ''}))
        return
    } else {
        pingPongTimer = setInterval(() => {
            port.postMessage({ping: true})
        }, 5000)
        port.onDisconnect.addListener(() => {
            const error = chrome.runtime.lastError?.message
            if (error) {
                // просто игнорируем это безобразие (хз как это фиксить)
                if (error !== 'The page keeping the extension port is moved into back/forward cache, so the message channel is closed.') {
                    console.error(error)
                }
            }
            clearInterval(pingPongTimer)
        })
    }
    self.port = port
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
    // const origNameTopic = topic
    try {
        console.log('Поиск ответов на сайте 24forcare.com по теме ' + topic + '...')
        // c " на сайте плохо ищется
        topic = topic.replaceAll(/["«»]/gi, '')
        let response = await fetch('https://24forcare.com/search/?query=' + topic)
        let text = await response.text()
        let doc = new JSDOM(text).window.document
        let shot = true
        if (!doc.querySelector('.item-name') && topic.match(/\s?-?\s?\d{4}$/gi)) {
            shot = false
            topic = topic.replaceAll(/\s?-?\s?\d{4}$/gi, '')
            response = await fetch('https://24forcare.com/search/?query=' + topic)
            text = await response.text()
            doc = new JSDOM(text).window.document
        }
        if (!doc.querySelector('.item-name') && topic.includes('клиническим рекомендациям') && topic.lastIndexOf('(') !== -1) {
            shot = false
            topic = topic.slice(0, topic.lastIndexOf('(')).trim()
            response = await fetch('https://24forcare.com/search/?query=' + topic)
            text = await response.text()
            doc = new JSDOM(text).window.document
        }
        if (!doc.querySelector('.item-name')) {
            shot = true
            response = await fetch('https://24forcare.com/search/?query=' + topic.substring(0, topic.length / 2))
            text = await response.text()
            doc = new JSDOM(text).window.document
        }
        if (!doc.querySelector('.item-name')) {
            console.warn('На сайте 24forcare.com не удалось найти ответы по теме ' + topic)
            return
        }
        const searchTopics = doc.querySelector('.shot') && shot ? doc.querySelectorAll('.shot') : doc.querySelectorAll('.item-name')
        for (const found of searchTopics) {
            const response2 = await fetch(found.href)
            const text2 = await response2.text()
            const doc2 = new JSDOM(text2).window.document
            let topicText = changeLetters(doc2.querySelector('h1').textContent.trim())
            // if (topicText.startsWith('Тест с ответами по теме «')) {
            //     topicText = topicText.replaceAll('Тест с ответами по теме «', '')
            //     topicText = topicText.slice(0, -1)
            // }
            console.log('Найдено ' + topicText)
            for (const el of doc2.querySelectorAll('.row h3')) {
                if (el.querySelector('tt') || el.querySelector('em')) continue // обрезаем всякую рекламу
                const questionText = changeLetters(el.textContent.trim().replace(/^\d+\.\s*/, ''))
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
                    const text = changeLetters(answer.textContent.trim()).replaceAll(/^"/g, '').replaceAll(/^\d+\) /g, '').replaceAll(/[\.\;\+"]+$/g, '')
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
    }
}

function changeLetters(str) {
    const replacements = {
        'a': 'а',
        'e': 'е',
        'o': 'о',
        'c': 'с',
        'x': 'х'
    };

    for (const [latin, cyrillic] of Object.entries(replacements)) {
        // Заменяем латинскую букву на кириллическую, если:
        // 1. Она окружена кириллическими буквами
        // 2. Или если она стоит одна, окруженная пробелами или знаками препинания
        const regex = new RegExp(
            `(?<=[\\u0400-\\u04FF])${latin}|${latin}(?=[\\u0400-\\u04FF])|\\b${latin}\\b`,
            'gi'
        );
        str = str.replace(regex, cyrillic);
    }
    return str;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
