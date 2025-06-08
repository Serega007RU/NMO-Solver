let hasGoodScore = false
let port
let stopRunning = false
let countSaveAnswers = 0
let countAnsweredAnswers = 0
let rejectWait
let running
let started

let cachedMessage = {}
let sentResults

let settings
let lastScore

let shadowRoot, observerAll, observerResize, globalObserver
const highLightDiv = document.createElement('div')
const autoDiv = document.createElement('div')
const errorDiv = document.createElement('div')
errorDiv.style.color = 'red'
const statusDiv = document.createElement('div')


function osReceiveStatus(message) {
    listenQuestions()
    if (message.settings) settings = message.settings
    if (message.lastScore) lastScore = message.lastScore
    if (message.running) {
        stopRunning = false
        startRepeat = 0
        running = true
        start(message.collectAnswers)
    }
}
chrome.runtime.sendMessage({
    status: true,
    authData: JSON.parse(localStorage.getItem('rsmu_tokenData')) || JSON.parse(localStorage.getItem('tokenData')),
    cabinet: document.location.host.split('.')[0].split('-')[1]
}, osReceiveStatus)

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.start) {
        stopRunning = false
        startRepeat = 0
        running = true
        start()
    } else if (message.stop) {
        stop()
    } else if (message.hasTest) {
        const hasTest = Boolean(document.querySelector('.v-tabsheet-caption-close')) || Boolean(document.querySelector('lib-quiz-page'))
        sendResponse({hasTest})
    } else if (message.status) {
        osReceiveStatus(message)
    } else if (message.checkThrottle) {
        let countCheckTimer = 0
        const checkTimer = setInterval(() => {
            countCheckTimer++
            // console.log('сработало', countCheckTimer)
            if (countCheckTimer >= 10) {
                clearInterval(checkTimer)
                sendResponse({success: true})
            }
        }, 10)
        return true
    }
})

async function portListener(message) {
    if (message.answers && (!cachedMessage.question || cachedMessage.question.question === message.question.question)) {
        cachedMessage = message
        if (document.querySelector('.question-inner-html-text')) {
            highlightAnswers()
        }
    } else if (message.stats) {
        if (message.error) {
            errorDiv.innerText = message.error
        }
        statusDiv.innerText = 'Статистка учтённых ответов' + (message.error || settings.offlineMode || !settings.sendResults || !message.stats?.isServer ? ' (локально)' : '') + `:\n${message.stats.correct} правильных\n${message.stats.taken} учтено\n${message.stats.ignored} без изменений`
    } else {
        console.warn('Не соответствие сообщения, возможно в процесс вмешался пользователь', message, cachedMessage.question.question)
        return
    }
    if (settings.mode === 'manual' || !running || !started) return

    await answerQuestion()
}

async function answerQuestion() {
    if (stopRunning) return

    // ждём когда прогрузится кнопка следующий вопрос, или завершить тест, или результаты тестов
    await globalObserver.waitFor('.question-buttons-one-primary:not([disabled="true"],[style="display: none;"]), .question-buttons-primary:not([disabled="true"],[style="display: none;"]), .questionList')

    // сбор правильных и не правильных ответов
    if (document.querySelector('.questionList')) {
        // sendResults()
        await wait(1000)
        await simulateClick(document.querySelector('.mdc-button.mat-primary'))
        return
    }

    const topic = (document.querySelector('.expansion-panel-title') || document.querySelector('.mat-mdc-card-title')).textContent.trim()
    if (!settings.goodScore && topic.includes(' - Предварительное тестирование')) {
        if (document.querySelector('.expansion-panel-custom_toggle-title')?.textContent === 'Развернуть') {
            await simulateClick(document.querySelector('.expansion-panel-custom_toggle-title'))
            await wait(500)
            await randomWait()
        }
        // сразу нажимаем "Завершить тестирование"
        await simulateClick(document.querySelector('.quiz-info-row .quiz-buttons-primary:not([disabled="true"],[style="display: none;"])'))
        await randomWait()
        // подтверждаем завершение теста
        await simulateClick(document.querySelector('.mdc-dialog__surface .mdc-button.mat-primary'))
        // ждём когда пропадёт эта кнопка (типа всё прогрузится)
        await globalObserver.waitFor('.mdc-dialog__surface .mdc-button.mat-primary', {remove: true})
        // runTest()
        return
    }

    if (!cachedMessage.answers) {
        console.warn('не подгружены ответы, возможно пользователь вмешался или произошёл двойной запуск')
        return
    }

    // тут мы типо думаем над вопросом, от 3 до 30 секунд
    if (settings.answerWaitMax && (!topic.includes(' - Предварительное тестирование') || settings.goodScore)) {
        await wait(Math.random() * (settings.answerWaitMax - settings.answerWaitMin) + settings.answerWaitMin, true)
    }

    if (!cachedMessage.answers) {
        console.warn('не подгружены ответы, возможно пользователь вмешался или произошёл двойной запуск')
        return
    }

    // для начала проверяем случайно не отвечали ли уже на этот вопрос (на случай если страница обновлялась)
    let checkedElement = document.querySelector('input[type="checkbox"]:checked')
    let attemptCount = 0
    while (checkedElement) {
        attemptCount++
        if (attemptCount > 30) break
        let element
        // выбираем между radio или checkbox (input) и span (label)
        if (Math.random() < 0.75) {
            element = checkedElement.closest('.mdc-form-field').firstElementChild
        } else {
            element = checkedElement
        }
        const answersElements = document.querySelectorAll('.question-inner-html-text')
        const idOfLastAnswer = answersElements[answersElements.length - 1].closest('.mdc-form-field').querySelector('input').id
        await simulateClick(element)
        await randomWait()
        // подобным дибильным образом мы ждём когда кривой скрипт сайта перестроит все элементы ответов
        await globalObserver.waitFor('#' + idOfLastAnswer, {remove: true})
        checkedElement = document.querySelector('input[type="checkbox"]:checked')
    }

    if (!cachedMessage.answers) {
        console.warn('не подгружены ответы, возможно пользователь вмешался или произошёл двойной запуск')
        return
    }

    for (const answer of cachedMessage.answers.sort(() => 0.5 - Math.random())) {
        const answersElements = document.querySelectorAll('.question-inner-html-text')
        for (const el of answersElements) {
            if (normalizeText(el.textContent) === answer) {
                // если он уже выбран, то нет смысла снова его тыкать
                if (el.closest('.mdc-form-field').querySelector('input').checked) {
                    continue
                }
                let element
                // выбираем между radio или checkbox (input) и span (label)
                if (Math.random() < 0.75) {
                    element = el.closest('.mdc-form-field').firstElementChild
                } else {
                    element = el
                }
                const idOfLastAnswer = answersElements[answersElements.length - 1].closest('.mdc-form-field').querySelector('input').id
                await simulateClick(element)
                await randomWait()
                // подобным дибильным образом мы ждём когда кривой скрипт сайта перестроит все элементы ответов
                await globalObserver.waitFor('#' + idOfLastAnswer, {remove: true})
                break
            }
        }
    }

    // let hasChecked = false
    // for (const el of document.querySelectorAll('.mdc-checkbox__native-control')) {
    //     if (el?.checked) {
    //         hasChecked = true
    //     }
    // }
    // for (const el of document.querySelectorAll('.mdc-radio__native-control')) {
    //     if (el?.checked) {
    //         hasChecked = true
    //     }
    // }
    // if (!hasChecked) {
    //     debugger
    // }

    await nextQuestion()

    // runTest()
}

async function nextQuestion() {
    // highlightAnswers(true)
    // если мы видим кнопку завершения теста
    const nextQuestionButton = document.querySelector('.mat-card-actions-container .mat-primary:not([disabled="true"],[style="display: none;"])')
    if (nextQuestionButton) {
        if (nextQuestionButton.textContent.trim() === 'Завершить тестирование') {
            await simulateClick(nextQuestionButton)
            countAnsweredAnswers = countAnsweredAnswers + 1
            // ждёт когда на предыдущий (или все предыдущие) вопрос завершиться fetch (http) запрос сохранения ответа (save-answer)
            await waitSendAnswer()
            await randomWait()
            // подтверждаем завершение теста
            await simulateClick(document.querySelector('.mdc-dialog__surface .mdc-button.mat-primary'))
            // ждём когда пропадёт эта кнопка (типа всё прогрузится)
            await globalObserver.waitFor('.mdc-dialog__surface .mdc-button.mat-primary', {remove: true})
            // несколько тупой костыль заставляющий перезагрузить страницу если результаты теста не высвечиваются
            await globalObserver.waitFor('.questionList', {add: true, dontReject: true})
            // runTest()
        } else {
            // const waitNextQuestion = waitForLoadNextQuestion()
            // кликаем следующий вопрос
            await simulateClick(nextQuestionButton)
            // await waitNextQuestion
            countAnsweredAnswers = countAnsweredAnswers + 1
        }
    }
}

async function attemptToClosePopups(count = 0) {
    let popup = Array.from(document.querySelectorAll('.popupContent')).filter(el => el.innerText.trim().length).pop()
    while (popup) {
        if (stopRunning) return
        if (popup.querySelector('.v-window-closebox:not(.v-window-closebox-disabled)')) {
            const waitRemove = globalObserver.waitFor('.v-window-closebox', {removeOnce: true})
            await simulateClick(popup.querySelector('.v-window-closebox:not(.v-window-closebox-disabled)'), count, true)
            await randomWait()
            await waitRemove
            // а зачем здесь "Назад" в проверке? А потому что портал может открыть тест в popup'е, ДА, ВЕСЬ тест прямо в popup'e!!!
        } else if (popup.querySelector('.v-button') && (!popup.querySelector('.v-button').textContent.endsWith('Назад') && !popup.querySelector('.v-button').textContent.startsWith(''))) {
            const waitRemove = globalObserver.waitFor('.v-button', {removeOnce: true})
            await simulateClick(popup.querySelector('.v-button'), count, true)
            await randomWait()
            await waitRemove
        } else if (popup.querySelector('[class*="v-Notification"]')) {
            const waitRemove = globalObserver.waitFor('[class*="v-Notification"]', {removeOnce: true})
            await simulateClick(popup.querySelector('[class*="v-Notification"]'), count, true)
            await randomWait()
            popup.querySelector('[class*="v-Notification"]')?.dispatchEvent(new AnimationEvent('animationend', {animationName: 'valo-animate-in-fade'}))
            popup.querySelector('[class*="v-Notification"]')?.dispatchEvent(new AnimationEvent('animationend', {animationName: 'valo-animate-out-fade'}))
            await waitRemove
        } else {
            break
        }
        popup = Array.from(document.querySelectorAll('.popupContent')).filter(el => el.innerText.trim().length).pop()
    }
}

let startRepeat = 0
let hasISTask = false
let hasBack = false
async function start(collectAnswers) {
    if (stopRunning) return
    if (!running) return
    if (!globalObserver) globalObserver = new GlobalSelectorMutationObserver()
    listenQuestions(true)
    if (!port) {
        port = chrome.runtime.connect()
        port.onMessage.addListener(portListener)
        port.onDisconnect.addListener(() => port = null)
    }
    if (collectAnswers) port.postMessage({collectAnswers})

    startRepeat++
    if (startRepeat > settings.maxAttemptsNext) {
        const back = document.querySelector('.v-button-blue-button.v-button-icon-align-right')?.parentElement?.firstElementChild
        if (back?.textContent?.includes('Назад')) {
            // TODO тупой костыль исправляющий проблему бесконечного прожатия вперёд если кнопка "Получить новый вариант" не активна но она обязательная для нажатия
            await simulateClick(back)
            await wait(500)
        }
        chrome.runtime.sendMessage({reloadPage: true, error: 'Слишком много попыток запуска теста или перейти на следующий этап'})
        return
    }

    countSaveAnswers = 0
    countAnsweredAnswers = 0

    await globalObserver.waitFor('.v-app-loading', {remove: true})

    await wait(250)
    await randomWait()

    if (hasISTask) {
        hasISTask = false
        if (document.querySelector('.v-window-closebox:not(.v-window-closebox-disabled)')?.parentElement?.textContent === 'Быстрый переход') {
            await attemptToClosePopups()

            const topic = normalizeText(document.querySelector('.v-label.v-widget.wrap-text').innerText)

            // Нажимаем закрыть вкладку
            await simulateClick(document.querySelector('.v-tabsheet-tabitem-selected .v-tabsheet-caption-close'))
            await wait(500)
            await randomWait()

            // подтверждаем закрытие вкладки
            await attemptToClosePopups()
            await wait(500)
            await randomWait()

            // Если вкладки всё ещё остались, проходим на них тесты, если нет вкладок, отправляем в background что мы закончили работать
            const hasTest = document.querySelectorAll('.v-tabsheet-caption-close').length >= 1
            port.postMessage({done: true, topic, error: 'Прохождение ситуационных задач не поддерживается', hasTest})
            if (hasTest) start()
            return
        }
    }

    await attemptToClosePopups()

    if (document.querySelector('.v-slot-h1')?.textContent.toLowerCase().includes('вариант №')) {
        const waitReaction = globalObserver.waitFor('.v-widget', {change: true})
        await simulateClick(Array.from(document.querySelectorAll('.v-button-caption')).find(el => el.textContent === 'Завершить') || Array.from(document.querySelectorAll('.v-button-caption')).find(el => el.textContent === 'Вернуться к обучению'))
        await waitReaction
        start(collectAnswers)
        return
    }

    if (document.querySelector('.v-align-center .v-button-caption')?.textContent === 'Скачать сертификат' || document.querySelector('.v-align-center .v-button-caption')?.textContent === 'Ожидание выгрузки результатов...') {
        // TODO не всегда получается дождаться скачивания сертификата
        // await globalObserver.waitFor('.v-align-center .v-button-caption', {text: 'Скачать сертификат'})
        if (settings.goodScore && !hasGoodScore && !hasBack) {
            hasBack = true
            const waitNext = globalObserver.waitFor('.c-groupbox-nocollapsable, .v-slot-iom-elementbox-text', {change: true})
            // TODO иногда кнопка Далее активна и есть страница дальше даже после страницы получения сертификата
            await simulateClick(document.querySelector('.v-button-blue-button.v-button-icon-align-right').parentElement.firstElementChild)
            await waitNext
            // await globalObserver.waitFor('.c-table-clickable-cell')
        } else {
            const topic = normalizeText(document.querySelector('.v-label.v-widget.wrap-text').innerText)

            // Нажимаем закрыть вкладку
            await simulateClick(document.querySelector('.v-tabsheet-tabitem-selected .v-tabsheet-caption-close'))
            await wait(500)
            await randomWait()

            // подтверждаем закрытие вкладки
            await attemptToClosePopups()
            await wait(500)
            await randomWait()

            // Если вкладки всё ещё остались, проходим на них тесты, если нет вкладок, отправляем в background что мы закончили работать
            const hasTest = document.querySelectorAll('.v-tabsheet-caption-close').length >= 1
            port.postMessage({done: true, topic, hasTest})
            if (hasTest) {
                startRepeat = 0
                start()
            }
            return
        }
    } else if (!settings.selectionMethod && lastScore?.score?.includes('Оценка 2') && lastScore?.topic && !lastScore.topic.includes(' - Предварительное тестирование')) {
        const topic = normalizeText(document.querySelector('.v-label.v-widget.wrap-text').innerText)
        if (topic === normalizeText(lastScore.topic)) {
            // Нажимаем закрыть вкладку
            await simulateClick(document.querySelector('.v-tabsheet-tabitem-selected .v-tabsheet-caption-close'))
            await wait(500)
            await randomWait()

            // подтверждаем закрытие вкладки
            await attemptToClosePopups()
            await wait(500)
            await randomWait()

            // Если вкладки всё ещё остались, проходим на них тесты, если нет вкладок, отправляем в background что мы закончили работать
            const hasTest = document.querySelectorAll('.v-tabsheet-caption-close').length >= 1
            port.postMessage({done: true, topic, error: 'Нет ответов на данный тест', hasTest})
            if (hasTest) start()
            return
        }
    }

    let hasSuccessTest = false
    let countGood = 0
    const pageName = document.querySelector('.c-groupbox-nocollapsable .c-groupbox-caption-text')?.textContent?.trim()
    // если мы видим список вариантов (тестов), анализируем их
    if (document.querySelector('.v-table-cell-content:first-child')) {
        let index = 0
        for (const variant of document.querySelectorAll('.v-table-cell-content:first-child')) {
            index = index + 1
            const variantText = variant.textContent.trim()
            if (variantText.toLowerCase().includes('задача')) {
                if (!variantText.toLowerCase().includes('оценка')) {
                    await simulateClick(variant.querySelector('span'))
                    start(collectAnswers)
                    return
                } else {
                    hasSuccessTest = true
                }
            } else if (collectAnswers) {
                if (variantText.includes('оценка ') && !variantText.includes('оценка 2') && collectAnswers === index) {
                    console.log('смотрим вариант', collectAnswers, variantText)
                    collectAnswers = collectAnswers + 1
                    port.postMessage({collectAnswers})
                    await simulateClick(variant.querySelector('span'))
                    runTest()
                    return
                }
            } else if (variantText.includes(' - не завершен')) {
                // нажимаем на найденный тест
                await simulateClick(variant.querySelector('span'))
                runTest()
                return
            } else if (pageName === 'Предварительное тестирование') {
                hasSuccessTest = true
            } else if (settings.goodScore) {
                const date = variantText.match(/(\d{1,2}[\.\/]){2,2}(\d{2,4})?/g)?.[0]
                const dt = new Date(date?.replace(/(\d{2})\.(\d{2})\.(\d{4})/,'$3-$2-$1'))
                if (Date.now() - dt.getTime() > 2592000000) continue
                if (variantText.includes('оценка 3')) {
                    countGood += 1
                } else if (variantText.includes('оценка 4')) {
                    countGood += 8
                } else if (variantText.includes('оценка 5')) {
                    countGood += 60
                }
                if (countGood >= 240) {
                    hasSuccessTest = true
                    hasGoodScore = true
                }
            } else if (variantText.includes('оценка 3') || variantText.includes('оценка 4') || variantText.includes('оценка 5')) {
                hasSuccessTest = true
            }
        }
    }

    if (pageName === 'Запись вебинара') {
        hasSuccessTest = true
        hasGoodScore = true
    }

    if (collectAnswers) {
        if (document.querySelector('.c-table-clickable-cell')) {
            console.log('просмотр ответов окончен')
            stop()
        } else {
            runTest()
        }
        return
    }

    if (pageName === 'Задача' ||
        pageName === 'Интерактивные ситуационные задачи' ||
        pageName === 'Интерактивная ситуационная задача' ||
        pageName === 'Задачи для самоподготовки' ||
        document.querySelector('.c-groupbox-nocollapsable .v-slot-c-flowlayout .v-button .v-button-caption')?.textContent === 'Получить задачи'
    ) {
        hasISTask = true
    }

    const buttonNewVariant = document.querySelector('.c-groupbox-nocollapsable .v-slot-c-flowlayout .v-button:not([aria-disabled="true"]) .v-button-caption')
    if (!hasSuccessTest && buttonNewVariant) {
        await wait(500)
        // если тест не запущен и нет пройденного, то получаем новый вариант
        await simulateClick(buttonNewVariant)
        await attemptToClosePopups()
        if (hasISTask) {
            hasISTask = false
            await globalObserver.waitFor('.v-table', {change: true})
            start(collectAnswers)
            return
        }
        // ждём когда появится новый тест и открываем его
        const variant = await globalObserver.waitFor('.c-table-clickable-cell', {text: ' - не завершен'})
        await randomWait()
        await attemptToClosePopups()
        await simulateClick(variant)
        runTest()
        return
    }

    // Если есть кнопка "Далее" и по кругу перезапускаем данную функцию
    const next = document.querySelector('.v-button-blue-button.v-button-icon:not([aria-disabled="true"])')
    if (next) {
        const waitNext = globalObserver.waitFor('.c-groupbox-nocollapsable, .v-slot-iom-elementbox-text', {change: true})
        await simulateClick(next)
        await waitNext
        // await wait(250)
        await randomWait()
        start()
    } else {
        runTest()
    }
}

async function runTest() {
    if (stopRunning) return

    // ждём когда прогрузится панелька (заголовок)
    const button = await globalObserver.waitFor('.quiz-info-row .quiz-buttons-primary:not([disabled="true"],[style="display: none;"])')
    if (button.textContent.trim() === 'Начать тестирование') {
        await simulateClick(button)
        await randomWait()
    }

    // Если ранее уже отвечали на вопросы, то ищем последний не отвеченный вопрос и переключаемся на него
    if (document.querySelector('.item-test_answered')) {
        const lastNotAnswered = document.querySelector('.item-test:not(.item-test_answered)')
        if (lastNotAnswered && !lastNotAnswered.classList.contains('item-test_current')) {
            if (document.querySelector('.expansion-panel-custom_toggle-title')?.textContent === 'Развернуть') {
                await simulateClick(document.querySelector('.expansion-panel-custom_toggle-title'))
                await wait(500)
                await randomWait()
            }
            await simulateClick(lastNotAnswered)
            await randomWait()
        }
    }

    if (cachedMessage.answers || sentResults) answerQuestion()
    started = true
}

function sendQuestion() {
    if (!port) {
        port = chrome.runtime.connect()
        port.onMessage.addListener(portListener)
        port.onDisconnect.addListener(() => port = null)
    }
    const question = {
        question: normalizeText(document.querySelector('.question-title-text').textContent),
        answers: {
            type: document.querySelector('.mat-card-question__type').textContent.trim(),
            answers: Array.from(document.querySelectorAll('.question-inner-html-text')).map(item => normalizeText(item.textContent)).sort()
        },
        topics: [normalizeText((document.querySelector('.expansion-panel-title') || document.querySelector('.mat-mdc-card-title')).textContent)],
        lastOrder: document.querySelector('.question-info-questionCounter').textContent.trim().match(/\d+/)[0]
    }
    const questionNew = {
        question: normalizeTextNew(document.querySelector('.question-title-text').textContent),
        answers: {
            type: document.querySelector('.mat-card-question__type').textContent.trim(),
            answers: Array.from(document.querySelectorAll('.question-inner-html-text')).map(item => normalizeTextNew(item.textContent)).sort()
        },
        topics: [normalizeTextNew((document.querySelector('.expansion-panel-title') || document.querySelector('.mat-mdc-card-title')).textContent, true)],
        lastOrder: document.querySelector('.question-info-questionCounter').textContent.trim().match(/\d+/)[0]
    }
    cachedMessage = {}
    cachedMessage.question = question
    statusDiv.textContent = 'Обращение к базе данных с ответами...'
    port.postMessage({question: questionNew, new: true})
    port.postMessage({question})
}

// сбор правильных и не правильных ответов
function sendResults() {
    if (sentResults) return
    sentResults = true
    if (running && started) {
        globalObserver?.rejectAllWait('canceled, user intervened')
        rejectWait?.()
    }
    if (!port) {
        port = chrome.runtime.connect()
        port.onMessage.addListener(portListener)
        port.onDisconnect.addListener(() => port = null)
    }
    autoDiv.replaceChildren()
    errorDiv.replaceChildren()
    statusDiv.textContent = 'Сохранение результатов теста...'
    const correctAnswersElements = document.querySelectorAll('.questionList-item')
    const sendObject = {}
    const sendObjectNew = {new: true}
    const results = []
    const resultsNew = []
    for (const el of correctAnswersElements) {
        const question = {
            question: normalizeText(el.querySelector('.questionList-item-content-title').textContent),
            answers: {
                type: el.querySelector('.questionList-item-content-question-type')?.textContent?.trim?.(),
                usedAnswers: Array.from(el.querySelectorAll('.questionList-item-content-answer-text')).map(item => normalizeText(item.textContent)).sort()
            },
            correct: Boolean(el.querySelector('[svgicon="correct"]')),
            lastOrder: el.querySelector('.questionList-item-number').textContent.trim()
        }
        results.push(question)
    }
    for (const el of correctAnswersElements) {
        const question = {
            question: normalizeTextNew(el.querySelector('.questionList-item-content-title').textContent),
            answers: {
                type: el.querySelector('.questionList-item-content-question-type')?.textContent?.trim?.(),
                usedAnswers: Array.from(el.querySelectorAll('.questionList-item-content-answer-text')).map(item => normalizeTextNew(item.textContent)).sort()
            },
            correct: Boolean(el.querySelector('[svgicon="correct"]')),
            lastOrder: el.querySelector('.questionList-item-number').textContent.trim()
        }
        resultsNew.push(question)
    }
    const topic = (document.querySelector('.expansion-panel-title') || document.querySelector('.mat-mdc-card-title')).textContent
    sendObject.topic = normalizeText(topic)
    sendObject.results = results
    sendObject.lastScore = {topic, score: document.querySelector('.quiz-info-col-indicators')?.textContent?.replaceAll('\n', ' ')}
    const topicNew = (document.querySelector('.expansion-panel-title') || document.querySelector('.mat-mdc-card-title')).textContent
    sendObjectNew.topic = normalizeTextNew(topicNew, true)
    sendObjectNew.results = resultsNew
    sendObjectNew.lastScore = {topic: topicNew, score: document.querySelector('.quiz-info-col-indicators')?.textContent?.replaceAll('\n', ' ')}
    port.postMessage(sendObjectNew)
    port.postMessage(sendObject)

    if (settings.mode === 'manual' || !running || !started) return

    answerQuestion()
}

// console.log('injected!')

// таким уродским костылём ждём когда следующий вопрос 100% прогрузится
// function waitForLoadNextQuestion() {
//     return new Promise((resolve, reject) => {
//         const timer = setTimeout(() => {
//             chrome.runtime.sendMessage({reloadPage: true, error: 'Истекло время ожидания вопроса'})
//         }, Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin)
//
//         rejectWait = () => {
//             rejectWait = null
//             observer.disconnect()
//             clearTimeout(timer)
//             reject('canceled, user intervened')
//         }
//
//         const observer = new MutationObserver((mutations) => {
//             for (const mutation of mutations) {
//                 if (mutation.type === 'attributes' && mutation.attributeName === 'disabled') {
//                     if (!mutation.target.disabled && mutation.target.closest('.mdc-form-field')) {
//                         observer.disconnect()
//                         clearTimeout(timer)
//                         rejectWait = null
//                         resolve(mutation.target)
//                         break
//                     }
//                 }
//             }
//         })
//         observer.observe(document.documentElement, {attributes: true, childList: true, subtree: true})
//     })
// }

async function simulateClick(element, count = 0, closePopup) {
    if (stopRunning) return
    if (count > 7) {
        running = false
        port.postMessage({error: 'Не удалось найти кнопку относительно координат'})
        throw Error('Не удалось найти кнопку относительно координат')
    }
    if (!count || count === 3 || count === 6) {
        element.scrollIntoView({block: 'center'})
    }
    let coords1 = getRandomCoordinates(element)
    // кликаем именно на элемент который виден в DOM относительно координат
    const newElement = document.elementFromPoint(coords1.x, coords1.y)
    // проверяем попали мы на тот элемент или нам что-то мешает
    if (element !== newElement) {
        // если не попали, то шерстим весь DOM и проверяем попали мы на родительский или дочерние элементы
        if (element.contains(newElement)) {
            element = newElement
            coords1 = getRandomCoordinates(element)
        } else {
            let parentElement = element.parentElement
            let found = false
            while (parentElement) {
                if (parentElement === newElement) {
                    element = newElement
                    coords1 = getRandomCoordinates(element)
                    found = true
                    break
                }
                parentElement = parentElement.parentElement
            }
            if (!found) {
                console.warn('не удалось найти кнопку, пробуем это сделать повторно')
                await wait(500)
                // TODO ну это просто к какому-ту дерьму всё идёт, иногда эти чёртовы popup'ы выскакивают тогда когда ты этого НЕ ОЖИДАЕШЬ
                await attemptToClosePopups(count + 1)
                // если мы данным кликом уже закрываем popup, то не стоит снова пробовать нажать
                if (closePopup) return
                // бывает другие элементы частично налезают на нашу кнопку или выходят за границы экрана,
                // поэтому мы повторными попытками пытаемся подобрать другие координаты
                await simulateClick(element, count + 1)
                return
            }
        }
    } else {
        element = newElement
        coords1 = getRandomCoordinates(element)
    }
    const coords2 = getRandomCoordinates(element)
    element.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, cancelable: true, view: window, clientX: coords2.x, clientY: coords2.y, screenX: coords2.x, screenY: coords2.y}))
    if (settings.clickWaitMax) await wait(Math.random() * (500 - 100) + 100)
    element.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, view: window, clientX: coords1.x, clientY: coords1.y, screenX: coords1.x, screenY: coords1.y, buttons: 1, detail: 1}))
    if (settings.clickWaitMax) await wait(Math.random() * (250 - 50) + 50)
    element.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, cancelable: true, view: window, clientX: coords1.x, clientY: coords1.y, screenX: coords1.x, screenY: coords1.y, buttons: 0, detail: 1}))
    element.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window, clientX: coords1.x, clientY: coords1.y, screenX: coords1.x, screenY: coords1.y, buttons: 0, detail: 1}))
}

function getRandomCoordinates(element, half) {
    // получаем координаты элемента
    const box = element.getBoundingClientRect()
    let left = box.left
    let right = box.right
    let top = box.top
    let bottom = box.bottom
    if (!left && !right && !top && !bottom) {
        running = false
        port.postMessage({error: 'Не удалось получить координаты кнопки, возможно эта кнопка пропала неожиданно для расширения из DOM'})
        throw Error('Не удалось получить координаты кнопки, возможно эта кнопка пропала неожиданно для расширения из DOM')
    }
    if (half) {
        // вычисляем самую центральную точку элемента
        const xCenter = (box.left + box.right) / 2
        const yCenter = (box.top + box.bottom) / 2
        // сужаем границы координат на половину
        left = (left + xCenter) / 2
        right = (xCenter + right) / 2
        top = (top + yCenter) / 2
        bottom = (yCenter + bottom) / 2
    }
    // генерируем рандомные координаты для клика
    const x = Math.floor(Math.random() * (right - left) + left)
    const y = Math.floor(Math.random() * (bottom - top) + top)
    // TODO стоит учесть что элемент может быть за границами экрана
    return {x, y}
}

function highlight(element, color) {
    const div = document.createElement('div')
    const clientRect = element.getBoundingClientRect()
    div.style.left = clientRect.left + window.scrollX + 'px'
    div.style.top = clientRect.top + window.scrollY + 'px'
    div.style.width = clientRect.width + 10 + 'px'
    div.style.height = clientRect.height + 'px'
    div.style.position = 'absolute'
    div.style.background = color
    div.style.zIndex = '2147483647'
    div.style.pointerEvents = 'none'
    highLightDiv.append(div)
}

function stop() {
    running = false
    started = false
    stopRunning = true
    globalObserver?.rejectAllWait('canceled, user intervened')
    rejectWait?.()
    countSaveAnswers = 0
    countAnsweredAnswers = 0
    port?.postMessage({running: false, collectAnswers: null})
}

async function randomWait() {
    if (settings.clickWaitMax) await wait(Math.random() * (settings.clickWaitMax - settings.clickWaitMin) + settings.clickWaitMin)
}

function wait(ms, question) {
    let showTimer
    if (ms >= 250) {
        let count = ms / 1000
        showTimer = setInterval(() => {
            count -= 0.1
            if (count < 0) {
                clearInterval(showTimer)
                autoDiv.innerText = 'ㅤ'
            }
            if (question) {
                autoDiv.innerText = 'Думаем над вопросом ' + count.toFixed(1)
            } else {
                autoDiv.innerText = 'Задержка между нажатиями ' + count.toFixed(1)
            }
        }, 100)
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            rejectWait = null
            clearInterval(showTimer)
            autoDiv.innerText = 'ㅤ'
            resolve()
        }, ms)
        rejectWait = () => {
            clearTimeout(timer)
            clearInterval(showTimer)
            autoDiv.innerText = 'ㅤ'
            reject('canceled, user intervened')
            rejectWait = null
        }
    })
}

// здесь дожидаемся когда все http (fetch) запросы save-answers завершатся
async function waitSendAnswer() {
    let count = Math.floor(Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin)
    while (count > 0) {
        if (stopRunning) return
        if (countSaveAnswers >= countAnsweredAnswers) {
            break
        } else {
            await wait(100)
        }
        count -= 100
        autoDiv.innerText = 'Ждём ответа от портала ' + (count / 1000).toFixed(1)
    }
    autoDiv.innerText = 'ㅤ'
    if (count <= 0) console.warn('не дождались завершения http запросов save-answers', countAnsweredAnswers)
}

const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
        if (entry.name.endsWith('/save-answer')) {
            countSaveAnswers++
            // console.log('save-answer', countSaveAnswers)
        } else if (entry.name.endsWith('/token')) {
            chrome.runtime.sendMessage({authData: JSON.parse(localStorage.getItem('rsmu_tokenData')) || JSON.parse(localStorage.getItem('tokenData')), cabinet: document.location.host.split('.')[0].split('-')[1]})
        }
    }
})
observer.observe({entryTypes: ['resource']})

function highlightAnswers(remove) {
    const order = document.querySelector('.question-info-questionCounter')?.textContent?.trim()?.match(/\d+/)[0] // бывает такое что попадается один и тот же вопрос, но с разными ответами, приходится вот так извращаться
    if (!remove && (
        !cachedMessage.question ||
        cachedMessage.question.question !== normalizeText(document.querySelector('.question-title-text').textContent) ||
        (order && cachedMessage.question.lastOrder && !cachedMessage.question.lastOrder[order] && cachedMessage.question.lastOrder !== order))) {
        if (running && started) {
            globalObserver?.rejectAllWait('canceled, user intervened')
            rejectWait?.()
        }
        sendQuestion()
        return
    }
    highLightDiv.replaceChildren()
    if (remove || !cachedMessage.answers) {
        if (remove) {
            cachedMessage = {}
            statusDiv.replaceChildren()
        }
        return
    }
    for (const el of document.querySelectorAll('.question-inner-html-text')) {
        const formField = el.closest('.mdc-form-field')
        if (formField.querySelector('input:disabled')) return
        if (cachedMessage.answers?.includes(normalizeText(el.textContent))) {
            highlight(formField, cachedMessage.correct ? 'rgb(26 182 65 / 60%)' : 'rgb(190 123 9 / 60%)')
        } else if (formField.querySelector('input:checked')) {
            if (cachedMessage.correct) {
                highlight(formField, 'rgb(190 9 9 / 60%)')
            }
        }
    }
    if (cachedMessage.correct) {
        statusDiv.innerText = 'Подсвечены правильные ответы'
    } else {
        statusDiv.innerText = 'В ' + (cachedMessage.error || settings.offlineMode ? 'локальной ' : '') + 'базе нет ответов на данный вопрос\nОтветы подсвечены методом подбора\nосталось вариантов ответов ' + cachedMessage.question?.answers[cachedMessage.answerHash].combinations.length
    }
    if (cachedMessage.error) {
        errorDiv.innerText = cachedMessage.error
    } else {
        errorDiv.replaceChildren()
    }
}

function listenQuestions(start) {
    if ((start ? !document.querySelector('.v-app') : true) && !document.location.href.includes('/quiz-wrapper/') && !document.querySelector('lib-quiz-page')) return
    if (shadowRoot) return
    addShadowRoot()
    if (document.querySelector('.questionList')) {
        sendResults()
    }
    function onChanged() {
        if (document.querySelector('.question-inner-html-text')) {
            highlightAnswers()
        } else if (cachedMessage.question) {
            highlightAnswers(true)
        }
        if (document.querySelector('.questionList')) {
            sendResults()
        }
    }

    observerAll = new MutationObserver(onChanged)
    observerAll.observe(document.documentElement, {attributes: true, childList: true, subtree: true})

    observerResize = new ResizeObserver(onChanged)
    observerResize.observe(document.documentElement)
}

function addShadowRoot() {
    shadowRoot = document.body.attachShadow({mode: 'closed'})
    shadowRoot.append(document.createElement('slot'))
    shadowRoot.prepend(highLightDiv)
    const mainDiv = document.createElement('div')
    shadowRoot.prepend(mainDiv)
    const div = document.createElement('div')
    div.style.padding = '10px'
    div.style.width = '300px'
    div.style.height = '100px'
    div.style.position = 'fixed'
    div.style.bottom = '10px'
    div.style.left = '10px'
    div.style.borderRadius = '15px'
    div.style.color = 'black'
    div.style.background = '#ffffff'
    div.style.boxShadow = '0 6px 8px 0 rgba(34, 60, 80, 0.1)'
    div.style.zIndex = '2147483647'
    div.style.pointerEvents = 'none'
    div.style.lineHeight = '1'
    div.style.margin = '0'
    const headerH1 = document.createElement('h1')
    headerH1.style.justifySelf = 'center'
    headerH1.style.textAlign = 'center'
    headerH1.style.width = '150px'
    headerH1.style.fontWeight = 'lighter'
    headerH1.style.fontSize = '16px'
    headerH1.style.borderBottom = 'solid 2px #212121'
    headerH1.style.marginBottom = '10px'
    headerH1.style.padding = '3px'
    headerH1.style.marginTop = '0'
    headerH1.textContent = '🧊 НМО Решатель'
    div.append(headerH1)
    const mainBody = document.createElement('div')
    mainBody.style.fontSize = '14px'
    mainBody.style.textAlign = 'center'
    mainBody.style.margin = '0'
    mainBody.append(autoDiv)
    mainBody.append(errorDiv)
    mainBody.append(statusDiv)
    div.append(mainBody)
    mainDiv.append(div)
}

class GlobalSelectorMutationObserver {
    constructor() {
        this.observer = new MutationObserver(this.handleMutations.bind(this))
        this.config = { attributes: true, childList: true, subtree: true }
        this.selectors = new Map() // Храним селекторы и их Promises
        this.observer.observe(document.documentElement, this.config)
    }

    waitFor(selector, options) {
        return new Promise((resolve, reject) => {
            if (!options) options = {add: true}
            const result = this.checkForResolve(null, selector, options)
            if (result) {
                resolve(result)
                return
            }

            const timerTimeoutId = setTimeout(() => {
                chrome.runtime.sendMessage({reloadPage: true, error: `Истекло время ожидания элемента "${selector}", options: ${JSON.stringify(options)}`})
                reject('timeout')
            }, Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin)

            if (!this.selectors.has(selector)) {
                this.selectors.set(selector, [])
            }
            this.selectors.get(selector).push({ resolve, reject, options, timerTimeoutId })
        })
    }

    // listenFor(listener, selector, options) {
    //     if (!this.selectors.has(selector)) {
    //         this.selectors.set(selector, [])
    //     }
    //     this.selectors.get(selector).push({ listener, options })
    // }

    handleMutations(mutations) {
        this.selectors.forEach((resolvers, selector) => {
            let shouldDelete = false

            resolvers.forEach(({ resolve, options, timerTimeoutId }) => {
                const result = this.checkForResolve(mutations, selector, options)
                if (result) {
                    shouldDelete = true
                    clearTimeout(timerTimeoutId)
                    resolve(result)
                }
            })

            if (shouldDelete) {
                this.selectors.delete(selector)
            }
        })
    }

    checkForResolve(mutations, selector, options) {
        if (options.removeOnce) {
            if (!mutations) return
            for (const mutation of mutations) {
                for (const el of mutation.removedNodes) {
                    if (el?.matches?.(selector) || el?.querySelector?.(selector)) {
                        return el
                    }
                }
            }
        } else if (options.change) {
            if (!mutations) return
            for (const mutation of mutations) {
                const element = mutation?.target?.matches?.(selector) || mutation?.target?.closest?.(selector) || mutation?.target?.querySelector?.(selector)
                if (element) return element
            }
        // } else if (options.attribute) {
        //     if (!mutations) return
        //     // ещё пока не доработано
        } else {
            const element = document.querySelector(selector)
            if (options.add) {
                if (element) return element
            } else if (options.remove) {
                if (!element) return true
            } else if (options.text) {
                const textContent = element?.textContent?.trim()
                if (textContent && (!options.reverse ? textContent.includes(options.text) : !textContent.includes(options.text))) {
                    return element
                }
            } else {
                throw Error('Не верно передан options')
            }
        }
    }

    rejectAllWait(reason) {
        this.selectors.forEach((resolvers, selector) => {
            resolvers.forEach(({ resolve, reject, options, timerTimeoutId }) => {
                clearTimeout(timerTimeoutId)
                options.dontReject ? resolve() : reject(reason)
            })
            this.selectors.delete(selector)
        })
    }

    // noinspection JSUnusedGlobalSymbols
    disconnect() {
        this.observer.disconnect()
        this.selectors.clear()
    }
}