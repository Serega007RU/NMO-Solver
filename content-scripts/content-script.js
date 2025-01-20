let hasGoodScore = false
let port
let stopRunning = false
let countSaveAnswers = 0
let countAnsweredAnswers = 0
let rejectWait
let running

let cachedQuestion, cachedAnswers, cachedCorrect, cachedAnswerHash, cachedError, sentResults

let settings
let lastScore

let shadowRoot, highLightDiv, statusDiv, statusBody, observerAll, observerResize


function osReceiveStatus(message) {
    if (message.settings) settings = message.settings
    if (message.lastScore) lastScore = message.lastScore
    if (message.running) {
        stopRunning = false
        startRepeat = 0
        running = true
        start(message.collectAnswers)
    }
    if (message.settings) {
        listenQuestions()
    }
}
chrome.runtime.sendMessage({
    status: true,
    authData: JSON.parse(localStorage.getItem('rsmu_tokenData')) || JSON.parse(localStorage.getItem('tokenData')),
    cabinet: document.location.host.split('.')[0].split('-')[1]
}, osReceiveStatus)

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.start) {
        if (stopRunning) {
            chrome.runtime.sendMessage({reloadPage: true})
        } else {
            stopRunning = false
            startRepeat = 0
            running = true
            start()
        }
    } else if (message.stop) {
        stop()
    } else if (message.hasTest) {
        const hasTest = Boolean(document.querySelector('.v-tabsheet-caption-close')) || Boolean(document.querySelector('lib-quiz-page'))
        sendResponse({hasTest})
    } else if (message.status) {
        osReceiveStatus(message)
    }
})

async function portListener(message) {
    if (settings.mode === 'manual') {
        if (statusBody && !running) {
            if (message.answers && (!cachedQuestion || cachedQuestion.question === message.question.question)) {
                cachedAnswers = message.answers
                cachedQuestion = message.question
                cachedCorrect = message.correct
                cachedAnswerHash = message.answerHash
                cachedError = message.error
                if (document.querySelector('.question-inner-html-text')) {
                    highlightAnswers()
                }
            } else if (message.stats) {
                statusBody.innerText = `Статистка учтённых ответов:\n${message.stats.correct} правильных\n${message.stats.taken} учтено\n${message.stats.ignored} без изменений`
            }
        }
        return
    }

    // ждём когда прогрузится кнопка следующий вопрос или завершить тест
    await watchForElement('.question-buttons-one-primary:not([disabled="true"],[style="display: none;"]), .question-buttons-primary:not([disabled="true"],[style="display: none;"])')

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
        await watchForElement('.mdc-dialog__surface .mdc-button.mat-primary', true)
        runTest()
        return
    }

    await randomWait()

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
        await watchForElement('#' + idOfLastAnswer, true)
        checkedElement = document.querySelector('input[type="checkbox"]:checked')
    }

    for (const answer of message.answers.sort(() => 0.5 - Math.random())) {
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
                await watchForElement('#' + idOfLastAnswer, true)
                break
            }
        }
    }

    let hasChecked = false
    for (const el of document.querySelectorAll('.mdc-checkbox__native-control')) {
        if (el?.checked) {
            hasChecked = true
        }
    }
    for (const el of document.querySelectorAll('.mdc-radio__native-control')) {
        if (el?.checked) {
            hasChecked = true
        }
    }
    if (!hasChecked) {
        debugger
    }

    await nextQuestion()

    runTest()
}

async function nextQuestion() {
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
            await watchForElement('.mdc-dialog__surface .mdc-button.mat-primary', true)
        } else {
            const waitNextQuestion = waitForLoadNextQuestion()
            // кликаем следующий вопрос
            await simulateClick(nextQuestionButton)
            await waitNextQuestion
            countAnsweredAnswers = countAnsweredAnswers + 1
        }
    }
}

async function attemptToClosePopups(count = 0) {
    let popup = Array.from(document.querySelectorAll('.popupContent')).filter(el => el.innerText.length).pop()
    while (popup) {
        if (stopRunning) return
        if (popup.querySelector('.v-window-closebox:not(.v-window-closebox-disabled)')) {
            const waitRemove = watchForRemoveElement('.v-window-closebox')
            await simulateClick(popup.querySelector('.v-window-closebox:not(.v-window-closebox-disabled)'), count)
            await randomWait()
            await waitRemove
            // а зачем здесь "Назад" в проверке? А потому что портал может открыть тест в popup'е, ДА, ВЕСЬ тест прямо в popup'e!!!
        } else if (popup.querySelector('.v-button') && !popup.querySelector('.v-button').textContent.endsWith('Назад')) {
            const waitRemove = watchForRemoveElement('.v-button')
            await simulateClick(popup.querySelector('.v-button'), count)
            await randomWait()
            await waitRemove
        } else if (popup.querySelector('[class*="v-Notification"]')) {
            const waitRemove = watchForRemoveElement('[class*="v-Notification"]')
            await simulateClick(popup.querySelector('[class*="v-Notification"]'), count)
            await randomWait()
            popup.querySelector('[class*="v-Notification"]')?.dispatchEvent(new AnimationEvent('animationend', {animationName: 'valo-animate-in-fade'}))
            popup.querySelector('[class*="v-Notification"]')?.dispatchEvent(new AnimationEvent('animationend', {animationName: 'valo-animate-out-fade'}))
            await waitRemove
        } else {
            break
        }
        popup = Array.from(document.querySelectorAll('.popupContent')).filter(el => el.innerText.length).pop()
    }
}

let startRepeat = 0
let hasISTask = false
let hasBack = false
async function start(collectAnswers) {
    if (stopRunning) {
        stop()
        return
    }
    if (!running) return
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

    await watchForElement('.v-app-loading', true)

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
        let waitReaction = watchForChangeElement('.v-widget')
        await simulateClick(Array.from(document.querySelectorAll('.v-button-caption')).find(el => el.textContent === 'Завершить') || Array.from(document.querySelectorAll('.v-button-caption')).find(el => el.textContent === 'Вернуться к обучению'))
        await waitReaction
        start(collectAnswers)
        return
    }

    if (document.querySelector('.v-align-center .v-button-caption')?.textContent === 'Скачать сертификат' || document.querySelector('.v-align-center .v-button-caption')?.textContent === 'Ожидание выгрузки результатов...') {
        // TODO не всегда получается дождаться скачивания сертификата
        // await watchForText('.v-align-center .v-button-caption', 'Скачать сертификат')
        if (settings.goodScore && !hasGoodScore && !hasBack) {
            hasBack = true
            const waitNext = watchForChangeElement('.v-slot-iom-elementbox-text')
            // TODO иногда кнопка Далее активна и есть страница дальше даже после страницы получения сертификата
            await simulateClick(document.querySelector('.v-button-blue-button.v-button-icon-align-right').parentElement.firstElementChild)
            await waitNext
            // await watchForElement('.c-table-clickable-cell')
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
    const testName = document.querySelector('.c-groupbox-caption-iom-elementbox-text')?.textContent?.trim()
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
            } else if (testName === 'Предварительное тестирование') {
                hasSuccessTest = true
            } else if (settings.goodScore) {
                if (variantText.includes('оценка 3')) {
                    countGood += 1
                } else if (variantText.includes('оценка 4')) {
                    countGood += 8
                } else if (variantText.includes('оценка 5')) {
                    countGood += 30
                }
                if (countGood >= 60) {
                    hasSuccessTest = true
                    hasGoodScore = true
                }
            } else if (variantText.includes('оценка 3') || variantText.includes('оценка 4') || variantText.includes('оценка 5')) {
                hasSuccessTest = true
            }
        }
    }

    if (testName === 'Запись вебинара') {
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

    if (testName === 'Задача' ||
        testName === 'Интерактивные ситуационные задачи' ||
        testName === 'Интерактивная ситуационная задача' ||
        testName === 'Задачи для самоподготовки' ||
        document.querySelector('.c-groupbox-content-iom-elementbox-text .v-slot-c-flowlayout .v-button .v-button-caption')?.textContent === 'Получить задачи'
    ) {
        hasISTask = true
    }

    const buttonNewVariant = document.querySelector('.c-groupbox-content-iom-elementbox-text .v-slot-c-flowlayout .v-button:not([aria-disabled="true"]) .v-button-caption')
    if (!hasSuccessTest && buttonNewVariant) {
        await wait(500)
        // если тест не запущен и нет пройденного, то получаем новый вариант
        await simulateClick(buttonNewVariant)
        await attemptToClosePopups()
        if (hasISTask) {
            hasISTask = false
            await watchForChangeElement('.v-table')
            start(collectAnswers)
            return
        }
        // ждём когда появится новый тест и открываем его
        const variant = await watchForText('.c-table-clickable-cell', ' - не завершен')
        await randomWait()
        await attemptToClosePopups()
        await simulateClick(variant)
        runTest()
        return
    }

    // Если есть кнопка "Далее" и по кругу перезапускаем данную функцию
    const next = document.querySelector('.v-button-blue-button.v-button-icon-align-right:not([aria-disabled="true"])')
    if (next) {
        const waitNext = watchForChangeElement('.v-slot-iom-elementbox-text')
        await simulateClick(next)
        await waitNext
        // await wait(250)
        await randomWait()
        start()
    } else {
        runTest()
    }

    /* else {
        stop()
    }*/
}

async function runTest() {
    if (stopRunning) {
        stop()
        return
    }
    // if (!document.querySelector('.nmifo-logo')) {
    //     stop()
    //     return
    // }

    await randomWait()

    // ждём когда прогрузится панелька (заголовок)
    const button = await watchForElement('.quiz-info-row .quiz-buttons-primary:not([disabled="true"],[style="display: none;"])')
    if (button.textContent.trim() === 'Начать тестирование') {
        await simulateClick(button)
        await randomWait()
    }

    await watchForElement('.question-buttons-one-primary:not([disabled="true"],[style="display: none;"]), .question-buttons-primary:not([disabled="true"],[style="display: none;"]), .questionList')

    // console.log(document.querySelector('.question-title-text')?.textContent?.trim())

    const topic = (document.querySelector('.expansion-panel-title') || document.querySelector('.mat-mdc-card-title')).textContent.trim()
    
    // сбор правильных и не правильных ответов
    if (document.querySelector('.questionList')) {
        sendResults()
        await wait(1000)
        if (!stopRunning) {
            await simulateClick(document.querySelector('.mdc-button.mat-primary'))
        } else {
            stop()
        }
        return
    }

    // тут мы типо думаем над вопросом, от 3 до 30 секунд
    if (settings.answerWaitMax && !topic.includes(' - Предварительное тестирование')) {
        await wait(Math.random() * (settings.answerWaitMax - settings.answerWaitMin) + settings.answerWaitMin)
    }

    sendQuestion()
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
    if (statusBody) {
        cachedAnswers = null
        cachedError = null
        cachedCorrect = null
        cachedAnswerHash = null
        cachedQuestion = question
        statusBody.textContent = 'Обращение к серверу с ответами...'
    }
    port.postMessage({question})
}

function sendResults() {
    if (!port) {
        port = chrome.runtime.connect()
        port.onMessage.addListener(portListener)
        port.onDisconnect.addListener(() => port = null)
    }
    if (sentResults) return
    sentResults = true
    if (statusBody) statusBody.textContent = 'Подождите, мы сохраняем результаты теста...'
    const correctAnswersElements = document.querySelectorAll('.questionList-item')
    const sendObject = {}
    const results = []
    for (const el of correctAnswersElements) {
        const question = {
            question: normalizeText(el.querySelector('.questionList-item-content-title').textContent),
            answers: {
                type: el.querySelector('.questionList-item-content-question-type')?.textContent?.trim?.(),
                answers: Array.from(el.querySelectorAll('.questionList-item-content-answer-text')).map(item => normalizeText(item.textContent)).sort()
            },
            correct: Boolean(el.querySelector('[svgicon="correct"]')),
            lastOrder: el.querySelector('.questionList-item-number').textContent.trim()
        }
        results.push(question)
    }
    const topic = document.querySelector('.expansion-panel-title') || document.querySelector('.mat-mdc-card-title').textContent
    sendObject.topic = normalizeText(topic)
    sendObject.results = results
    sendObject.lastScore = {topic, score: document.querySelector('.quiz-info-col-indicators')?.textContent?.replaceAll('\n', ' ')}
    port.postMessage(sendObject)
}

// console.log('injected!')

function watchForElement(selector, reverse) {
    return new Promise((resolve, reject) => {
        const element = document.querySelector(selector)
        if (!reverse ? element : !element) {
            rejectWait = null
            resolve(element)
            return
        }

        let timer = setTimeout(() => {
            chrome.runtime.sendMessage({reloadPage: true, error: `Истекло время ожидания элемента "${selector}"`})
        }, Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin)

        rejectWait = () => {
            rejectWait = null
            observer.disconnect()
            clearTimeout(timer)
            reject('stopped by user')
        }

        const observer = new MutationObserver(() => {
            const element = document.querySelector(selector)
            if (!reverse ? element : !element) {
                observer.disconnect()
                clearTimeout(timer)
                rejectWait = null
                resolve(element)
            }
        })
        observer.observe(document.documentElement, {attributes: true, childList: true, subtree: true})
    })
}

function watchForText(selector, text, reverse) {
    return new Promise((resolve, reject) => {
        const element = document.querySelector(selector)
        const textContent = element?.textContent?.trim()
        if (textContent && (!reverse ? textContent.includes(text) : !textContent.includes(text))) {
            rejectWait = null
            resolve(element)
            return
        }

        let timer = setTimeout(() => {
            chrome.runtime.sendMessage({reloadPage: true, error: `Истекло время ожидания текста элемента "${selector}" "${text}"`})
        }, Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin)

        rejectWait = () => {
            rejectWait = null
            observer.disconnect()
            clearTimeout(timer)
            reject('stopped by user')
        }

        const observer = new MutationObserver(() => {
            const element = document.querySelector(selector)
            const textContent = element?.textContent?.trim()
            if (textContent && (!reverse ? textContent.includes(text) : !textContent.includes(text))) {
                observer.disconnect()
                clearTimeout(timer)
                rejectWait = null
                resolve(element)
            }
        })
        observer.observe(document.documentElement, {attributes: true, childList: true, subtree: true})
    })
}

function watchForChangeElement(selector) {
    return new Promise((resolve, reject) => {
        let timer = setTimeout(() => {
            chrome.runtime.sendMessage({reloadPage: true, error: `Истекло время ожидания изменения элемента "${selector}"`})
        }, Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin)

        rejectWait = () => {
            rejectWait = null
            observer.disconnect()
            clearTimeout(timer)
            reject('stopped by user')
        }

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                const element = mutation.target.matches(selector) || mutation.target.closest(selector) || mutation.target.querySelector(selector)
                if (element) {
                    observer.disconnect()
                    clearTimeout(timer)
                    rejectWait = null
                    resolve(element)
                    break
                }
            }
        })
        observer.observe(document.documentElement, {attributes: true, childList: true, subtree: true})
    })
}

function watchForRemoveElement(selector) {
    return new Promise((resolve, reject) => {
        let timer = setTimeout(() => {
            chrome.runtime.sendMessage({reloadPage: true, error: `Истекло время ожидания удаления элемента "${selector}"`})
        }, Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin)

        rejectWait = () => {
            rejectWait = null
            observer.disconnect()
            clearTimeout(timer)
            reject('stopped by user')
        }

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const el of mutation.removedNodes) {
                    if (el?.matches?.(selector) || el?.querySelector?.(selector)) {
                        observer.disconnect()
                        clearTimeout(timer)
                        rejectWait = null
                        resolve(el)
                        return
                    }
                }
            }
        })
        observer.observe(document.documentElement, {childList: true, subtree: true})
    })
}

// таким уродским костылём ждём когда следующий вопрос 100% прогрузится
function waitForLoadNextQuestion() {
    return new Promise((resolve, reject) => {
        let timer = setTimeout(() => {
            chrome.runtime.sendMessage({reloadPage: true, error: 'Истекло время ожидания вопроса'})
        }, Math.random() * (settings.timeoutReloadTabMax - settings.timeoutReloadTabMin) + settings.timeoutReloadTabMin)

        rejectWait = () => {
            rejectWait = null
            observer.disconnect()
            clearTimeout(timer)
            reject('stopped by user')
        }

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'disabled') {
                    if (!mutation.target.disabled && mutation.target.closest('.mdc-form-field')) {
                        observer.disconnect()
                        clearTimeout(timer)
                        rejectWait = null
                        resolve(mutation.target)
                        break
                    }
                }
            }
        })
        observer.observe(document.documentElement, {attributes: true, childList: true, subtree: true})
    })
}

async function simulateClick(element, count = 0) {
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
                // TODO ну это просто к какому-ту дерьму всё идёт, иногда эти чёртовы popup'ы выскакивают тогда когда ты этого НЕ ОЖИДАЕШЬ
                await attemptToClosePopups(count + 1)
                console.warn('не удалось найти кнопку, пробуем это сделать повторно')
                await wait(500)
                // бывает другие элементы частично налезают на нашу кнопку, поэтому
                // мы повторными попытками пытаемся подобрать другие координаты
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
    if (settings.answerWaitMax) await wait(Math.random() * (500 - 100) + 100)
    element.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, view: window, clientX: coords1.x, clientY: coords1.y, screenX: coords1.x, screenY: coords1.y, buttons: 1, detail: 1}))
    if (settings.answerWaitMax) await wait(Math.random() * (250 - 50) + 50)
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
    return {x, y}
}

function highlight(element, color) {
    const div = document.createElement('div')
    const clientRect = element.getBoundingClientRect()
    const clientOffset = getOffset(element)
    div.style.left = clientOffset.left + 'px'
    div.style.top = clientOffset.top + 'px'
    div.style.width = clientRect.width + 10 + 'px'
    div.style.height = clientRect.height + 'px'
    div.style.position = 'absolute'
    div.style.background = color
    div.style.zIndex = '2147483647'
    div.style.pointerEvents = 'none'
    highLightDiv.append(div)
}
function getOffset(el) {
    const rect = el.getBoundingClientRect()
    return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY
    }
}

function stop() {
    running = false
    stopRunning = true
    if (rejectWait) rejectWait()
    countSaveAnswers = 0
    countAnsweredAnswers = 0
    port.postMessage({running: false, collectAnswers: null})
}

async function randomWait() {
    if (settings.clickWaitMax) await wait(Math.random() * (settings.clickWaitMax - settings.clickWaitMin) + settings.clickWaitMin)
}

function wait(ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            rejectWait = null
            resolve()
        }, ms)
        rejectWait = () => {
            clearTimeout(timer)
            reject('stopped by user')
            rejectWait = null
        }
    })
}

// здесь дожидаемся когда все http (fetch) запросы save-answers завершатся
async function waitSendAnswer() {
    let count = 0
    const maxWait = Math.floor(Math.random() * (900 - 150) + 150)
    while (count <= maxWait) {
        if (stopRunning) {
            stop()
            return
        }
        if (countSaveAnswers === countAnsweredAnswers) {
            break
        } else {
            await wait(100)
        }
        count += 1
    }
    if (count > maxWait) console.warn('не дождались завершения http запросов save-answers', countAnsweredAnswers)
}

const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
        if (entry.name.endsWith('/save-answer')) {
            countSaveAnswers = countSaveAnswers + 1
            // console.log('save-answer', countSaveAnswers)
        } else if (entry.name.endsWith('/token')) {
            chrome.runtime.sendMessage({authData: JSON.parse(localStorage.getItem('rsmu_tokenData')) || JSON.parse(localStorage.getItem('tokenData')), cabinet: document.location.host.split('.')[0].split('-')[1]})
        }
    }
})
observer.observe({entryTypes: ['resource']})

function highlightAnswers(remove) {
    if (!remove && (!cachedQuestion || cachedQuestion.question !== normalizeText(document.querySelector('.question-title-text').textContent))) {
        sendQuestion()
        return
    }
    highLightDiv.replaceChildren()
    if (remove || !cachedAnswers) {
        if (remove) statusBody.innerText = 'Подсвечены правильные ответы'
        return
    }
    for (const el of document.querySelectorAll('.question-inner-html-text')) {
        const formField = el.closest('.mdc-form-field')
        if (formField.querySelector('input:disabled')) return
        if (cachedAnswers.includes(normalizeText(el.textContent))) {
            highlight(formField, cachedCorrect ? 'rgb(26 182 65 / 60%)' : 'rgb(190 123 9 / 60%)')
        } else if (formField.querySelector('input:checked')) {
            if (cachedCorrect) {
                highlight(formField, 'rgb(190 9 9 / 60%)')
            }
        }
    }
    if (cachedCorrect) {
        statusBody.innerText = 'Подсвечены правильные ответы'
    } else {
        statusBody.innerText = 'В локальной базе нет ответов на данный вопрос\nОтветы подсвечены методом подбора\nосталось вариантов ответов ' + cachedQuestion.answers[cachedAnswerHash].combinations.length
    }
    if (cachedError) {
        const error = document.createElement('div')
        error.style.color = 'red'
        error.innerText = cachedError
        statusBody.prepend(error)
    }
}

function listenQuestions() {
    if (!document.location.href.includes('/quiz-wrapper/') || running) {
        if (statusDiv?.childElementCount) {
            statusDiv.replaceChildren()
            statusBody = null
            sentResults = false
            highLightDiv.replaceChildren()
            observerAll.disconnect()
            observerResize.disconnect()
        }
        return
    }
    if (settings.mode === 'manual' && !statusDiv?.childElementCount) {
        addShadowRoot()
        if (document.querySelector('.questionList')) {
            sendResults()
        }
        function onChanged() {
            if (settings.mode !== 'manual' || !statusDiv?.childElementCount) return
            if (document.querySelector('.question-inner-html-text')) {
                highlightAnswers()
            } else if (cachedQuestion) {
                cachedAnswers = null
                cachedQuestion = null
                cachedCorrect = null
                cachedAnswerHash = null
                cachedError = null
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
    } else if (settings.mode !== 'manual' && statusDiv?.childElementCount) {
        statusDiv.replaceChildren()
        statusBody = null
        sentResults = false
        highLightDiv.replaceChildren()
        observerAll.disconnect()
        observerResize.disconnect()
    }
}

function addShadowRoot() {
    if (!shadowRoot) {
        shadowRoot = document.body.attachShadow({mode: 'closed'})
        shadowRoot.append(document.createElement('slot'))
    }
    if (!highLightDiv) {
        highLightDiv = document.createElement('div')
        shadowRoot.prepend(highLightDiv)
    }
    if (!statusDiv) {
        statusDiv = document.createElement('div')
        shadowRoot.prepend(statusDiv)
    }
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
    statusBody = document.createElement('div')
    statusBody.style.fontSize = '14px'
    statusBody.style.textAlign = 'center'
    statusBody.style.margin = '0'
    div.append(statusBody)
    statusDiv.append(div)
}
