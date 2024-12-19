import { openDB, deleteDB } from '/libs/idb.js';
import { default as objectHash } from '/libs/object-hash.js';
import { JSDOM } from '/libs/jsdom.js';
import '/utils.js'
import '/normalize-text.js'

self.JSDOM = JSDOM // TODO для меньшей нагрузки следует эту реализацию заменить на API chrome.offscreen (ну и говно-код же получится с его использованием)
self.objectHash = objectHash
self.openDB = openDB
self.deleteDB = deleteDB

let db
let runningTab
let stopRunning = false
let controller = new AbortController()
let collectAnswers = 0
let reloaded = 0
let started = 0
let startFunc
let settings

let firstInit = false
const initStage = {stage1: {current: 0, max: 0, percent: 0}, stage2: {current: 0, max: 0, percent: 0}, stage3: {current: 0, max: 0, percent: 0}}
let lastSend
const initializeFunc = init()
waitUntil(initializeFunc)
initializeFunc.finally(() => initializeFunc.done = true)
async function init() {
    const dbCheck = await openDB('check', 1, {upgrade: (db, oldVersion) => firstInit = oldVersion === 0})
    dbCheck.close()
    let json
    if (firstInit) {
        console.log('первая загрузка, загружаем ответы в базу данных')
        await deleteDB('check')
        initStage.stage1 = {current: 0, max: 1, percent: 0}
        sendStage()
        const response = await fetch(chrome.runtime.getURL('data/nmo_db.json'))
        json = await response.json()
        initStage.stage1.current = 1
        sendStage()
    }
    db = await openDB('nmo', 13, {upgrade})
    // TODO если бд инициализировалась но в ней нет никаких данных, значит это не успешная инициализация, пробуем её переинициализировать
    if (firstInit) {
        console.warn('Похоже бд не успешно инициализировалась, делаем это повторно')
        db.close()
        await deleteDB('nmo')
        db = await openDB('nmo', 13, {upgrade})
    }
    json = null
    self.db = db
    async function upgrade(db, oldVersion, newVersion, transaction) {
        if (oldVersion !== newVersion) {
            console.log('Обновление базы данных с версии ' + oldVersion + ' на ' + newVersion)
        }

        if (oldVersion === 0) {
            firstInit = true
            const questions = db.createObjectStore('questions', {autoIncrement: true})
            questions.createIndex('question', 'question', {unique: true})
            questions.createIndex('topics', 'topics', {multiEntry: true})
            // 1 - просто изменение, 2 - новый ответ
            questions.createIndex('newChange', 'newChange')
            const topics = db.createObjectStore('topics', {autoIncrement: true, keyPath: 'key'})
            topics.createIndex('name', 'name')
            // 0 - не выполнено, 1 - выполнено, 2 - есть ошибки
            topics.createIndex('completed', 'completed')
            topics.createIndex('code', 'code', {unique: true})
            topics.createIndex('id', 'id', {unique: true})
            // 1 - новая тема, 2 - есть изменения (да, немного не логично по сравнению с questions)
            topics.createIndex('newChange', 'newChange')
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
                timeoutReloadTabMin: 15000,
                timeoutReloadTabMax: 90000
            }, 'settings')

            const max = json.questions.length + json.topics.length
            initStage.stage2 = {current: 0, max, percent: 0}
            initStage.stage3 = {current: 0, max, percent: 0}
            sendStage()
            const promises = []
            function onComplete() {
                initStage.stage3.current += 1
                sendStage()
            }

            for (const question of json.questions) {
                const promise = questions.add(question)
                promises.push(promise)
                promise.finally(onComplete)
                initStage.stage2.current += 1
                if (initStage.stage2.current % 10000 === 0) {
                    // TODO таким вот тупорылым костылём мы избавляемся от провисания и дальнейшего схлопывания фонового процесса из-за ограничения по lifetime Serice Worker
                    //  waitUntil даже не помогает, всё из-за провисания
                    await questions.get(0)
                }
                sendStage()
            }

            for (const topic of json.topics) {
                topics.put(topic)
                const promise = topics.put(topic)
                promises.push(promise)
                promise.finally(onComplete)
                initStage.stage2.current += 1
                if (initStage.stage2.current % 10000 === 0) {
                    await questions.get(0)
                }
                sendStage()
            }

            await Promise.all(promises)

            openDB('check', 1)
            firstInit = false;

            (async () => {
                const tabs = await chrome.tabs.query({url: 'https://*.edu.rosminzdrav.ru/*'})
                for (const tab of tabs) {
                    if (tab.status === 'complete') {
                        chrome.scripting.executeScript({files: ['normalize-text.js', 'content-scripts/content-script.js'], target: {tabId: tab.id}})
                    }
                }
            })();
            return
        }

        if (oldVersion <= 12) {
            console.log('Этап обновления с версии 12 на 13')
            settings = await transaction.objectStore('other').get('settings')
            settings.timeoutReloadTabMin = 15000
            settings.timeoutReloadTabMax = 90000
            await transaction.objectStore('other').put(settings, 'settings')
        }

        console.log('Обновление базы данных завершено')
    }

    firstInit = false

    settings = await db.get('other', 'settings')
    self.settings = settings

    await toggleContentScript()
    await toggleVisibleScript()
    await toggleRuleSet()

    console.log('started background!')
}

chrome.runtime.onInstalled.addListener(function(details) {
    if (details.reason === 'install') {
        chrome.runtime.openOptionsPage()
    }
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
            if (object.id && !topic.id) {
                topic.id = object.id
                if (!topic.newChange) topic.newChange = 2
            }
            if (object.code && !topic.code) {
                topic.code = object.code
                if (!topic.newChange) topic.newChange = 2
            }
            if (object.name && !topic.name) {
                topic.name = object.name
                if (!topic.newChange) topic.newChange = 2
            }
            console.log('Обновлён', topic)
        } else {
            topic = object
            topic.completed = 0
            // TODO временно
            topic.needSearchAnswers = true
            topic.newChange = 1
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

function sendStage() {
    let changed
    for (let x=1; x<=3; x++) {
        const stage = initStage['stage' + x]
        const percent = (100 * stage.current / stage.max) | 0
        if (stage.percent !== percent) {
            initStage['stage' + x].percent = percent
            changed = percent
        }
    }
    if (changed === 100 || (changed && Date.now() - lastSend >= 1000)) {
        lastSend = Date.now();
        (async () => {
            try {
                await chrome.runtime.sendMessage({initStage})
            } catch (ignored) {}
        })()
    }
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
                sendResponse({running: runningTab === sender.tab.id, collectAnswers, settings})
            })()
            return true
        }
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
    if (firstInit) {
        chrome.runtime.openOptionsPage()
        return
    }
    await initializeFunc
    if (settings.mode === 'manual' || settings.mode === 'disabled') {
        chrome.runtime.openOptionsPage()
        return
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
    if (started >= settings.maxReloadTest) {
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
            await db.delete('topics', educationalElement.key)
            educationalElement.key = newTopic.key
        }
    }
    if (educationalElement.id !== foundEE.id) {
        educationalElement.id = foundEE.id
        if (!educationalElement.newChange) educationalElement.newChange = 2
    }
    if (educationalElement.name !== foundEE.name) {
        educationalElement.name = foundEE.name
        if (!educationalElement.newChange) educationalElement.newChange = 2
    }
    if (educationalElement.code !== foundEE.number) {
        educationalElement.code = foundEE.number
        if (!educationalElement.newChange) educationalElement.newChange = 2
    }
    // educationalElement.completed = completed
    // educationalElement.status = status
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
                    // await searchOnSites(message.question.topics[0], topic.key)
                    delete topic.needSearchAnswers
                    await db.put('topics', topic)
                }
            } else {
                topicKey = await db.put('topics', {name: message.question.topics[0], newChange: 1})
                console.log('Внесена новая тема в базу', message.question.topics[0])
                // TODO временно
                // await searchOnSites(message.question.topics[0], topicKey)
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
                    port.postMessage({answers, question, answerHash})
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
                        port.postMessage({answers: question.correctAnswers[answerHash], question, correct: true, answerHash})
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
                        port.postMessage({answers, question, answerHash})
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
                question.newChange = 1
                console.log('добавлен новый вопрос', question)
                // await searchOnAI(question, answerHash)
                // if (question.correctAnswers[answerHash]) {
                //     answers = question.correctAnswers[answerHash]
                // }
                question.answers[answerHash].lastUsedAnswers = answers
                port.postMessage({answers, question, answerHash})
                await db.put('questions', question)
            }
        // сохранение результатов теста с правильными и не правильными ответами
        } else if (message.results) {
            let stats = {correct: 0, taken: 0, ignored: 0}
            for (const resultQuestion of message.results) {
                let topicKey = await db.getKeyFromIndex('topics', 'name', resultQuestion.topics[0])
                if (!topicKey) {
                    topicKey = await db.put('topics', {name: resultQuestion.topics[0], newChange: 1})
                    console.log('Внесена новая тема в базу', resultQuestion.topics[0])
                    // await searchOnSites(resultQuestion.topics[0], topicKey)
                }
                let key = await db.getKeyFromIndex('questions', 'question', resultQuestion.question)
                // если мы получили ответ, но в бд его нет, сохраняем если этот ответ правильный
                if (!key) {
                    if (resultQuestion.correct) {
                        const correctQuestion = {
                            question: resultQuestion.question,
                            answers: {},
                            topics: [topicKey],
                            correctAnswers: {'unknown': resultQuestion.answers.answers},
                            newChange: 2
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
                    let changedOther = false
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
                            if (changedAnswers) stats.taken++
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
                        changedOther = true
                        delete question.lastOrder?.[resultQuestion.lastOrder]
                        if (!notAnswered) delete question.answers[foundAnswerHash].lastUsedAnswers

                        if (!question.topics.includes(topicKey)) {
                            changedCombinations = true
                            question.topics.push(topicKey)
                        }
                    }

                    if (changedAnswers || changedCombinations || changedOther) {
                        if (changedCombinations && !question.newChange) question.newChange = 1
                        if (changedAnswers) question.newChange = 2
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

self.searchOnSites = searchOnSites
async function searchOnSites(topic, topicKey) {
    if (!topicKey) {
        topicKey = await db.getKeyFromIndex('topics', 'name', topic)
    }
    chrome.action.setTitle({title: 'Выполняется поиск ответов в интернете'})
    chrome.action.setBadgeText({text: 'SEARCH'})
    try {
        await searchOn24forcare(topic, topicKey)
        if (stopRunning) return
        await searchOnReshnmo(topic, topicKey)
        // if (stopRunning) return
    } finally {
        if (!stopRunning) {
            chrome.action.setTitle({title: 'Расширение решает тест'})
            chrome.action.setBadgeText({text: 'ON'})
        }
    }
}

self.searchOn24forcare = searchOn24forcare
async function searchOn24forcare(topic, topicKey) {
    try {
        chrome.action.setTitle({title: 'Выполняется поиск ответов на сайте 24forcare'})
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
            let topicText = normalizeText(found.textContent)
            if (topicText.startsWith('тест с ответами по теме «')) {
                topicText = topicText.replaceAll('тест с ответами по теме «', '')
                topicText = topicText.slice(0, -1)
            }
            let newTopic = await db.getFromIndex('topics', 'name', topicText)
            if (newTopic) {
                if (newTopic.needSearchAnswers) {
                    delete newTopic.needSearchAnswers
                    await db.put('topics', newTopic)
                } else {
                    continue
                }
            }

            const response2 = await fetch(found.href, {signal: controller.signal})
            const text2 = await response2.text()
            const doc2 = new JSDOM(text2).window.document
            topicText = normalizeText(doc2.querySelector('h1').textContent)
            if (topicText.startsWith('тест с ответами по теме «')) {
                topicText = topicText.replaceAll('тест с ответами по теме «', '')
                topicText = topicText.slice(0, -1)
            }
            console.log('Найдено ' + topicText)
            newTopic = await db.getFromIndex('topics', 'name', topicText)
            if (!newTopic) {
                topicKey = await db.put('topics', {name: topicText, newChange: 1})
                console.log('Внесена новая тема в базу', topicText)
            }
            for (const el of doc2.querySelectorAll('.row h3')) {
                // noinspection JSDeprecatedSymbols
                if (el.querySelector('tt') || el.querySelector('em')) continue // обрезаем всякую рекламу
                const questionText = normalizeText(el.textContent.trim().replace(/^\d+\.\s*/, ''))
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
                await joinAnswers(topicKey, questionText, answers, correctAnswers)
            }
        }
        console.log('Поиск ответов на сайте 24forcare.com по теме ' + topic + ' окончен')
    } catch (error) {
        console.error('Ошибка поиска ответов на сайте 24forcare.com', error)
    }
}

async function searchOnReshnmo(topic, topicKey) {
    try {
        chrome.action.setTitle({title: 'Выполняется поиск ответов на сайте reshnmo.ru'})
        console.log('Поиск ответов на сайте reshnmo.ru по теме ' + topic + '...')
        let response = await fetch('https://reshnmo.ru/?s=' + topic)
        let text = await response.text()
        let doc = new JSDOM(text).window.document
        // удаляем всякую рекламу
        doc.querySelector('#secondary')?.remove()
        doc.querySelector('#related-posts')?.remove()
        if (!doc.querySelector('.post-cards .post-card__title')) {
            console.warn('На сайте reshnmo.ru не удалось найти ответы по теме ' + topic)
            return
        }
        for (const found of doc.querySelectorAll('.post-cards .post-card__title')) {
            let topicText = normalizeText(found.textContent)
            topicText = topicText.replaceAll('тест с ответами по теме «', '').replaceAll('» | тесты нмо с ответами', '')
            let newTopic = await db.getFromIndex('topics', 'name', topicText)
            if (newTopic) {
                if (newTopic.needSearchAnswers) {
                    delete newTopic.needSearchAnswers
                    await db.put('topics', newTopic)
                } else {
                    continue
                }
            }

            const response2 = await fetch(found.querySelector('.post-card__title a').href)
            const text2 = await response2.text()
            const doc2 = new JSDOM(text2).window.document
            topicText = normalizeText(doc2.querySelector('.entry-title').textContent)
            topicText = topicText.replaceAll('тест с ответами по теме «', '').replaceAll('» | тесты нмо с ответами', '')
            console.log('Найдено ' + topicText)
            newTopic = await db.getFromIndex('topics', 'name', topicText)
            if (!newTopic) {
                topicKey = await db.put('topics', {name: topicText, newChange: 1})
                console.log('Внесена новая тема в базу', topicText)
            }
            for (const el of doc2.querySelectorAll('.entry-content h3')) {
                // обрезаем всякую рекламу
                if (el.id === 'spetsialnosti-dlya-predvaritelnogo-i-itogovogo') continue
                const questionText = normalizeText(el.textContent.trim().replace(/^\d+\.\s*/, ''))
                const answers = []
                const correctAnswers = []
                for (const answer of el.nextElementSibling.childNodes) {
                    if (!answer.textContent.trim()) continue
                    // noinspection RegExpRedundantEscape
                    const text = normalizeText(answer.textContent.trim().replaceAll(/^"/g, '').replaceAll(/^\d+\) /g, '').replaceAll(/[\.\;\+"]+$/g, ''))
                    if (answer.tagName === 'STRONG') {
                        correctAnswers.push(text)
                    }
                    answers.push(text)
                }
                if (!answers.length || !correctAnswers.length) continue
                answers.sort()
                correctAnswers.sort()
                await joinAnswers(topicKey, questionText, answers, correctAnswers)
            }
        }
        console.log('Поиск ответов на сайте reshnmo.ru по теме ' + topic + ' окончен')
    } catch (error) {
        console.error('Ошибка поиска ответов на сайте reshnmo.ru', error)
    }
}

async function joinAnswers(topicKey, questionText, answers, correctAnswers) {
    const key = await db.getKeyFromIndex('questions', 'question', questionText)
    let question = {
        question: questionText,
        answers: {},
        correctAnswers: {},
        topics: [topicKey],
        newChange: 2
    }
    if (key) {
        question = await db.get('questions', key)
    }
    const answersHash = objectHash(answers)
    let changed = {}
    if (!question.answers[answersHash]) {
        changed.answers = true
        question.answers[answersHash] = {answers}
    } else if (question.answers[answersHash].combinations) {
        changed.combinations = true
        delete question.answers[answersHash].combinations
    }
    if (!question.correctAnswers[answersHash]) {
        changed.correctAnswers = true
        question.correctAnswers[answersHash] = correctAnswers
    }
    if (question.correctAnswers['unknown']) {
        for (const answer of correctAnswers) {
            const index = question.correctAnswers['unknown'].indexOf(answer)
            if (index !== -1) {
                changed.correctAnswers = true
                question.correctAnswers['unknown'].splice(index, 1)
            }
        }
    }
    if (question.correctAnswers['unknown']?.length === 0) {
        changed.correctAnswers = true
        delete question.correctAnswers['unknown']
    }
    if (!question.topics.includes(topicKey)) {
        changed.topics = true
        question.topics.push(topicKey)
    }
    if (Object.values(changed)) {
        question.newChange = 2
        console.log('С интернета добавлены или изменены ответы в бд', question, JSON.stringify(changed))
        // await db.put('questions', question, key)
    }
}

function showNotification(title, message) {
    console.log(title, message)
    chrome.action.setTitle({title: message})
    chrome.notifications.create({type: 'basic', message, title, iconUrl: 'img/icon128.png'})
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
