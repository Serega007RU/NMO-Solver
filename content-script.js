let simulateUser = false
let minWait = 500
let maxWait = 2000
let goodScore = true

let hasGoodScore = false
let port
let stopRunning = false
let countSaveAnswers = 0
let countAnsweredAnswers = 0
let rejectWait

let cachedQuestion, cachedAnswers, cachedCorrect, sentResults

let settings

let highLightDiv, statusBody
if (document.location.href.includes('/quiz-wrapper/')) {
    const shadowRoot = document.body.attachShadow({mode: 'closed'})
    shadowRoot.append(document.createElement('slot'))
    highLightDiv = document.createElement('div')
    shadowRoot.prepend(highLightDiv)
    const statusDiv = document.createElement('div')
    statusDiv.style.bottom = '0'
    statusDiv.style.left = '0'
    statusDiv.style.position = 'fixed'
    statusDiv.style.padding = '1em'
    statusDiv.style.zIndex = '2147483647'
    const statusTittle = document.createElement('div')
    statusTittle.textContent = 'НМО Решатель'
    statusTittle.style.textAlign = 'center'
    statusDiv.append(statusTittle)
    statusBody = document.createElement('div')
    statusDiv.append(statusBody)
    shadowRoot.prepend(statusDiv)
}


function osReceiveStatus(message) {
    if (message.running) {
        stopRunning = false
        nextRepeat = 0
        start(message.collectAnswers)
    }
    if (message.initializing && statusBody) {
        statusBody.innerText = 'Подождите\nИдёт инициализация\nлокальной базы данных\nэто может занять\nоколо 5-ти минут'
    }
    if (message.settings) {
        settings = message.settings
        listenQuestions()
        if (document.querySelector('.questionList')) {
            sendResults()
        }
    }
}
chrome.runtime.sendMessage({
    status: true,
    authData: JSON.parse(localStorage.getItem('rsmu_tokenData')),
    cabinet: document.location.host.split('.')[0].split('-')[1]
}, osReceiveStatus)

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.start) {
        if (stopRunning) {
            chrome.runtime.sendMessage({reloadPage: true})
        } else {
            nextRepeat = 0
            start()
        }
    } else if (message.stop) {
        stopRunning = true
        if (rejectWait) rejectWait()
    } else if (message.hasTest) {
        const hasTest = Boolean(document.querySelector('.v-tabsheet-caption-close')) || Boolean(document.querySelector('lib-quiz-page'))
        sendResponse({hasTest})
    } else if (message.status) {
        osReceiveStatus(message)
    }
})

async function portListener(message) {
    if (settings.mode === 'manual') {
        if (statusBody) {
            if (message.answers) {
                cachedAnswers = message.answers
                cachedQuestion = message.question
                cachedCorrect = message.correct
                if (document.querySelector('.question-inner-html-text')) {
                    highlightAnswers()
                    if (cachedCorrect) {
                        statusBody.innerText = 'Подсвечены правильные ответы'
                    } else {
                        statusBody.innerText = 'Подсвечены предполагаемые ответы\n(методом подбора)'
                    }
                }
            } else {
                statusBody.innerText = `Статистка учтённых ответов:\n${message.stats.correct} правильных\n${message.stats.taken} учтено\n${message.stats.ignored} без изменений`
            }
        }
        return
    }

    // ждём когда прогрузится кнопка следующий вопрос или завершить тест
    await watchForElement('.question-buttons-one-primary:not([disabled="true"],[style="display: none;"]), .question-buttons-primary:not([disabled="true"],[style="display: none;"])')

    const topic = (document.querySelector('.expansion-panel-title') || document.querySelector('.mat-mdc-card-title')).textContent.trim()
    if ((simulateUser || !goodScore) && topic.includes(' - Предварительное тестирование') || topic.includes(' - Входное тестирование')) {
        // сразу нажимаем "Завершить тестирование"
        await simulateClick(document.querySelector('.quiz-info-row .quiz-buttons-primary:not([disabled="true"],[style="display: none;"])'))
        await randomWait()
        // подтверждаем завершение теста
        simulateClick(document.querySelector('.mdc-dialog__surface .mdc-button.mat-primary'))
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
            element = checkedElement.closest('.mdc-form-field').lastElementChild
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
                    element = el.closest('.mdc-form-field').lastElementChild
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
            simulateClick(document.querySelector('.mdc-dialog__surface .mdc-button.mat-primary'))
            // ждём когда пропадёт эта кнопка (типа всё прогрузится)
            await watchForElement('.mdc-dialog__surface .mdc-button.mat-primary', true)
        } else {
            // кликаем следующий вопрос
            await simulateClick(nextQuestionButton)
            countAnsweredAnswers = countAnsweredAnswers + 1
        }
    }
}

async function attemptToClosePopups() {
    if (document.querySelector('.v-Notification')) {
        simulateClick(document.querySelector('.v-Notification'))
        document.querySelector('.v-Notification')?.dispatchEvent(new AnimationEvent('animationend', {animationName: 'valo-animate-in-fade'}))
        document.querySelector('.v-Notification')?.dispatchEvent(new AnimationEvent('animationend', {animationName: 'valo-animate-out-fade'}))
        await watchForElement('.v-Notification', true)
        await randomWait()
    }

    for (let x=0; x<=1; x++) {
        if (document.querySelector('.v-window-closebox:not(.v-window-closebox-disabled)')) {
            await simulateClick(Array.from(document.querySelectorAll('.v-window-closebox:not(.v-window-closebox-disabled)')).pop())
            // await watchForElement('.v-window-closebox:not(.v-window-closebox-disabled)', true)
            await randomWait()
        }
        // а зачем здесь "Назад" в проверке? А потому что портал может открыть тест в popup'е, ДА, ВЕСЬ тест прямо в popup'e!!!
        if (document.querySelector('.popupContent .v-button') && !document.querySelector('.popupContent .v-button').textContent.endsWith('Назад')) {
            await simulateClick(document.querySelector('.popupContent .v-button'))
            await watchForElement('.popupContent .v-button', true)
            await randomWait()
        }
    }
}

let nextRepeat = 0
let hasISTask = false
async function start(collectAnswers) {
    if (stopRunning) {
        stop()
        return
    }
    if (!port) {
        port = chrome.runtime.connect()
        port.onMessage.addListener(portListener)
    }
    if (collectAnswers) port.postMessage({collectAnswers})

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
            await randomWait()

            // Если вкладки всё ещё остались, проходим на них тесты, если нет вкладок, отправляем в background что мы закончили работать
            if (document.querySelectorAll('.v-tabsheet-caption-close').length >= 1) {
                port.postMessage({done: true, topic, error: 'Прохождение ситуационных задач не поддерживается', hasTest: true})
                start()
            } else {
                port.postMessage({done: true, topic, error: 'Прохождение ситуационных задач не поддерживается'})
            }
            return
        }
    }

    await attemptToClosePopups()

    if (document.querySelector('.v-align-center .v-button-caption')?.textContent === 'Скачать сертификат' || document.querySelector('.v-align-center .v-button-caption')?.textContent === 'Ожидание выгрузки результатов...') {
        // await watchForText('.v-align-center .v-button-caption', 'Скачать сертификат')
        if (goodScore && !hasGoodScore) {
            // TODO иногда кнопка Далее активна и есть страница дальше даже после страницы получения сертификата
            await simulateClick(document.querySelector('.v-button-blue-button.v-button-icon-align-right').parentElement.firstElementChild)
            await watchForElement('.c-table-clickable-cell')
        } else {
            const topic = normalizeText(document.querySelector('.v-label.v-widget.wrap-text').innerText)

            // Нажимаем закрыть вкладку
            await simulateClick(document.querySelector('.v-tabsheet-tabitem-selected .v-tabsheet-caption-close'))
            await wait(500)
            await randomWait()

            // подтверждаем закрытие вкладки
            await attemptToClosePopups()
            await randomWait()

            // Если вкладки всё ещё остались, проходим на них тесты, если нет вкладок, отправляем в background что мы закончили работать
            if (document.querySelectorAll('.v-tabsheet-caption-close').length >= 1) {
                port.postMessage({done: true, topic, hasTest: true})
                nextRepeat = 0
                start()
            } else {
                port.postMessage({done: true, topic})
            }
            return
        }
    // если мы находимся на странице системы обучения
    }/* else if (document.querySelector('.v-app')) {
        // Если вкладок нет, значит нам нечего решать
        if (!document.querySelectorAll('.v-tabsheet-caption-close')?.length) {
            port.postMessage({done: true})
            return
        }
    }*/

    let hasSuccessTest = false
    let countGood = 0
    const testName = document.querySelector('.c-groupbox-caption-iom-elementbox-text')?.textContent?.trim()
    // если мы видим список вариантов (тестов), анализируем их
    if (document.querySelector('.c-table-clickable-cell')) {
        let index = 0
        for (const variant of document.querySelectorAll('.c-table-clickable-cell')) {
            index = index + 1
            const variantText = variant.textContent.trim()
            if (collectAnswers) {
                if (variantText.includes('оценка ') && collectAnswers === index) {
                    console.log('смотрим вариант', collectAnswers, variantText)
                    collectAnswers = collectAnswers + 1
                    port.postMessage({collectAnswers})
                    variant.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, view: window}))
                    runTest()
                    return
                }
            } else if (variantText.includes(' - не завершен')) {
                // нажимаем на найденный тест
                await simulateClick(variant)
                runTest()
                return
            } else if (testName === 'Предварительное тестирование' || testName === 'Входное тестирование') {
                hasSuccessTest = true
            } else if (goodScore) {
                if (variantText.includes('оценка 3')) {
                    countGood += 1
                } else if (variantText.includes('оценка 4')) {
                    countGood += 5
                } else if (variantText.includes('оценка 5')) {
                    countGood += 15
                }
                if (countGood >= 30) {
                    hasSuccessTest = true
                    hasGoodScore = true
                }
            } else if (variantText.includes('оценка 3') || variantText.includes('оценка 4') || variantText.includes('оценка 5')) {
                hasSuccessTest = true
            }
        }
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

    if (testName === 'Задача' || testName === 'Интерактивные ситуационные задачи' || testName === 'Интерактивная ситуационная задача') {
        hasISTask = true
    }

    const buttonNewVariant = document.querySelector('.c-groupbox-content-iom-elementbox-text .v-slot-c-flowlayout .v-button:not([aria-disabled="true"]) .v-button-caption')
    if (!hasSuccessTest && buttonNewVariant && !hasISTask) {
        await wait(500)
        // если тест не запущен и нет пройденного, то получаем новый вариант
        await simulateClick(buttonNewVariant)
        await attemptToClosePopups()
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
        nextRepeat++
        if (nextRepeat > 16) {
            chrome.runtime.sendMessage({reloadPage: true, error: 'Слишком много попыток переключиться на следующий этап (вперёд)'})
            return
        }
        await simulateClick(next)
        await wait(250)
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
    if (simulateUser && !topic.includes(' - Предварительное тестирование') && !topic.includes(' - Входное тестирование')) {
        // await wait(Math.floor(Math.random() * (30000 - 3000) + 3000))
        await wait(Math.floor(Math.random() * (10000 - 3000) + 3000))
    }

    sendQuestion()
}

function sendQuestion() {
    if (!port) {
        port = chrome.runtime.connect()
        port.onMessage.addListener(portListener)
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
        cachedQuestion = question
        statusBody.textContent = ''
    }
    port.postMessage({question})
}

function sendResults() {
    if (!port) {
        port = chrome.runtime.connect()
        port.onMessage.addListener(portListener)
    }
    if (sentResults) return
    sentResults = true
    if (statusBody) statusBody.textContent = 'Подождите, мы сохраняем результаты теста...'
    const correctAnswersElements = document.querySelectorAll('.questionList-item')
    const results = []
    for (const el of correctAnswersElements) {
        const question = {
            question: normalizeText(el.querySelector('.questionList-item-content-title').textContent),
            answers: {
                type: el.querySelector('.questionList-item-content-question-type')?.textContent?.trim?.(),
                answers: Array.from(el.querySelectorAll('.questionList-item-content-answer-text')).map(item => normalizeText(item.textContent)).sort()
            },
            correct: Boolean(el.querySelector('[svgicon="correct"]')),
            topics: [normalizeText((document.querySelector('.expansion-panel-title') || document.querySelector('.mat-mdc-card-title')).textContent)],
            lastOrder: el.querySelector('.questionList-item-number').textContent.trim()
        }
        results.push(question)
    }
    port.postMessage({results})
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
            chrome.runtime.sendMessage({reloadPage: true, error: 'Истекло время ожидания'})
        // }, Math.floor(Math.random() * (30000 - 15000) + 15000))
        }, Math.floor(Math.random() * (60000 - 30000) + 30000))

        rejectWait = () => {
            stop()
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
            chrome.runtime.sendMessage({reloadPage: true, error: 'Истекло время ожидания'})
        // }, Math.floor(Math.random() * (30000 - 15000) + 15000))
        }, Math.floor(Math.random() * (60000 - 30000) + 30000))

        rejectWait = () => {
            stop()
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

async function simulateClick(element, count = 0) {
    if (count > 7) {
        port.postMessage({error: 'Не удалось найти кнопку относительно координат'})
        throw Error('Не удалось найти кнопку относительно координат')
    }
    if (!count || count === 3 || count === 6) {
        element.scrollIntoView({block: 'center'})
    }
    const {x, y} = getRandomCoordinates(element)
    // кликаем именно на элемент который виден в DOM относительно координат
    const newElement = document.elementFromPoint(x, y)
    // проверяем попали мы на тот элемент или нам что-то мешает
    if (element !== newElement) {
        // если не попали, то шерстим весь DOM и проверяем попали мы на родительский или дочерние элементы
        if (element.contains(newElement)) {
            element = newElement
        } else {
            let parentElement = element.parentElement
            let found = false
            while (parentElement) {
                if (parentElement === newElement) {
                    element = newElement
                    found = true
                    break
                }
                parentElement = parentElement.parentElement
            }
            if (!found) {
                // TODO ну это просто к какому-ту дерьму всё идёт, иногда эти чёртовы popup'ы выскакивают тогда когда ты этого НЕ ОЖИДАЕШЬ
                await attemptToClosePopups()

                await wait(500)
                // бывает другие элементы частично налезают на нашу кнопку, поэтому
                // мы повторными попытками пытаемся подобрать другие координаты
                await simulateClick(element, count + 1)
            }
        }
    } else {
        element = newElement
    }
    const {x2, y2} = getRandomCoordinates(element)
    element.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, cancelable: true, view: window, clientX: x2, clientY: y2, screenX: x2, screenY: y2}))
    if (simulateUser) await wait(Math.floor(Math.random() * (500 - 100) + 100))
    element.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, buttons: 1, detail: 1}))
    if (simulateUser) await wait(Math.floor(Math.random() * (250 - 50) + 50))
    element.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, buttons: 0, detail: 1}))
    element.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, buttons: 0, detail: 1}))
}

function getRandomCoordinates(element, half) {
    // получаем координаты элемента
    const box = element.getBoundingClientRect()
    let left = box.left
    let right = box.right
    let top = box.top
    let bottom = box.bottom
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
    const rect = el.getBoundingClientRect();
    return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY
    };
}

function stop() {
    stopRunning = false
    countSaveAnswers = 0
    countAnsweredAnswers = 0
    port.postMessage({running: false, collectAnswers: null})
}

async function randomWait() {
    if (simulateUser) await wait(Math.floor(Math.random() * (maxWait - minWait) + minWait))
}

function wait(ms) {
    return new Promise((resolve, reject) => {
        rejectWait = () => {
            stop()
            clearTimeout(ms)
            reject('stopped by user')
        }
        setTimeout(() => {
            rejectWait = null
            resolve()
        }, ms)
    })
}

// здесь дожидаемся когда все http (fetch) запросы save-answers завершатся
async function waitSendAnswer() {
    let count = 0
    while (count <= 150) {
        if (stopRunning) {
            stop()
            return
        }
        if (countSaveAnswers === countAnsweredAnswers) {
            break
        } else {
            await wait(100)
        }
        count = count + 1
    }
    if (count > 150) console.warn('не дождались завершения http запросов save-answers', countAnsweredAnswers)
}

const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
        if (entry.name.endsWith('/save-answer')) {
            countSaveAnswers = countSaveAnswers + 1
            // console.log('save-answer', countSaveAnswers)
        } else if (entry.name.endsWith('/token')) {
            chrome.runtime.sendMessage({authData: JSON.parse(localStorage.getItem('rsmu_tokenData')), cabinet: document.location.host.split('.')[0].split('-')[1]})
        }
    }
})
observer.observe({entryTypes: ['resource']})

function highlightAnswers(remove) {
    console.log('обновлены вопросы')
    if (!remove && (!cachedQuestion || cachedQuestion.question !== normalizeText(document.querySelector('.question-title-text').textContent))) {
        sendQuestion()
        return
    }
    highLightDiv.replaceChildren()
    if (remove || !cachedAnswers) return
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
}

function listenQuestions() {
    if (settings.mode === 'manual') {
        function onChanged() {
            if (document.querySelector('.question-inner-html-text')) {
                highlightAnswers()
            } else if (cachedQuestion) {
                cachedQuestion = null
                cachedAnswers = null
                cachedCorrect = null
                highlightAnswers(true)
            }
            if (document.querySelector('.questionList')) {
                sendResults()
            }
        }

        const observer = new MutationObserver(onChanged)
        observer.observe(document.documentElement, {attributes: true, childList: true, subtree: true})

        const resizeObserver = new ResizeObserver(onChanged)
        resizeObserver.observe(document.documentElement)
    }
}
