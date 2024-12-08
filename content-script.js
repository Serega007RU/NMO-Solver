let simulateUser = false
let minWait = 500
let maxWait = 2000
let goodScore = true

let hasGoodScore = false
let port
let running = false
let stopRunning = false
let countSaveAnswers = 0
let countAnsweredAnswers = 0
let rejectWait

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.text === 'change_status') {
        if (running) {
            stopRunning = true
        } else {
            running = true
            stopRunning = false
            start()
        }
        sendResponse({running})
    } else if (msg.text === 'start') {
        if (!running) {
            running = true
            stopRunning = false
            start()
        }
        sendResponse({running})
    } else if (msg.text === 'stop') {
        stopRunning = true
        if (rejectWait) rejectWait()
        sendResponse({running})
    } else if (msg.text === 'get_status') {
        sendResponse({running})
    } else if (msg.text === 'open_url') {
        document.location.href = msg.url
    }
})

chrome.runtime.sendMessage({text: 'get_status', authData: JSON.parse(localStorage.getItem('rsmu_tokenData'))}, (msg) => {
    if (msg.running) {
        running = true
        stopRunning = false
        start(msg.collectAnswers)
    }
})

async function portListener(message) {
    if (message?.ping) {
        port.postMessage({pong: true})
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
        document.querySelector('.mdc-dialog__surface .mdc-button.mat-primary').click()
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
        // выбираем между radio (или checkbox) и span (ответ с текстом)
        if (Math.random() < 0.75) {
            element = checkedElement.closest('.mdc-form-field').firstElementChild
        } else {
            element = checkedElement.closest('.mdc-form-field').lastElementChild
        }
        await simulateClick(element)
        await randomWait()
        checkedElement = document.querySelector('input[type="checkbox"]:checked')
    }

    for (const answer of message.sort(() => 0.5 - Math.random())) {
        for (const el of document.querySelectorAll('.question-inner-html-text:not([disabled="true"])')) {
            if (replaceBadSymbols(el.textContent).toLowerCase() === answer) {
                let element
                // выбираем между radio (или checkbox) и span (ответ с текстом)
                if (Math.random() < 0.75) {
                    element = el.closest('.mdc-form-field').firstElementChild
                } else {
                    element = el.closest('.mdc-form-field').lastElementChild
                }
                await simulateClick(element)
                await randomWait()
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
            document.querySelector('.mdc-dialog__surface .mdc-button.mat-primary').click()
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
    for (let x=0; x<=1; x++) {
        if (document.querySelector('.v-window-closebox:not(.v-window-closebox-disabled)')) {
            await simulateClick(Array.from(document.querySelectorAll('.v-window-closebox:not(.v-window-closebox-disabled)')).pop())
            // await watchForElement('.v-window-closebox:not(.v-window-closebox-disabled)', true)
            await randomWait()
        }
        if (document.querySelector('.popupContent .v-button')) {
            await simulateClick(document.querySelector('.popupContent .v-button'))
            await watchForElement('.popupContent .v-button', true)
            await randomWait()
        }
    }
}

let nextRepeat = 0
async function start(collectAnswers) {
    if (stopRunning) {
        stop()
        return
    }
    if (collectAnswers) running = true
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

    if (document.querySelector('.v-Notification')) {
        simulateClick(document.querySelector('.v-Notification'))
        document.querySelector('.v-Notification')?.dispatchEvent(new AnimationEvent('animationend', {animationName: 'valo-animate-in-fade'}))
        document.querySelector('.v-Notification')?.dispatchEvent(new AnimationEvent('animationend', {animationName: 'valo-animate-out-fade'}))
        await watchForElement('.v-Notification', true)
        await randomWait()
    }

    await attemptToClosePopups()

    if (document.querySelector('.v-align-center .v-button-caption')?.textContent === 'Скачать сертификат' || document.querySelector('.v-align-center .v-button-caption')?.textContent === 'Ожидание выгрузки результатов...') {
        // await watchForText('.v-align-center .v-button-caption', 'Скачать сертификат')
        if (goodScore && !hasGoodScore) {
            // TODO иногда кнопка Далее активна и есть страница дальше даже после страницы получения сертификата
            await simulateClick(document.querySelector('.v-button-blue-button.v-button-icon-align-right').parentElement.firstElementChild)
            await watchForElement('.c-table-clickable-cell')
        } else {
            const topic = replaceBadSymbols(document.querySelector('.v-label.v-widget.wrap-text').innerText).replaceAll(' - Итоговое тестирование', '').replaceAll(' - Предварительное тестирование', '').replaceAll(' - Входное тестирование', '').toLowerCase()

            // Нажимаем закрыть вкладку
            await simulateClick(document.querySelector('.v-tabsheet-tabitem-selected .v-tabsheet-caption-close'))
            await wait(500)
            await randomWait()

            // подтверждаем закрытие вкладки
            await attemptToClosePopups()
            await randomWait()

            // Если вкладки всё ещё остались, проходим на них тесты, если нет вкладок, отправляем в background что мы закончили работать
            if (document.querySelectorAll('.v-tabsheet-caption-close').length >= 1) {
                start()
            } else {
                port.postMessage({done: true, topic})
            }
            return
        }
    // если мы находимся на странице системы обучения
    } else if (document.querySelector('.v-app')) {
        // Если вкладок нет, значит нам нечего решать
        if (!document.querySelectorAll('.v-tabsheet-caption-close')?.length) {
            port.postMessage({done: true})
            return
        }
    }

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
            } else if (testName === 'Предварительное тестирование' || testName === 'Интерактивные ситуационные задачи' || testName === 'Входное тестирование' || testName === 'Задача') {
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

    if (!hasSuccessTest && (testName === 'Задача' || testName === 'Интерактивная ситуационная задача')) {
        const topic = replaceBadSymbols(document.querySelector('.v-label.v-widget.wrap-text').innerText).replaceAll(' - Итоговое тестирование', '').replaceAll(' - Предварительное тестирование', '').replaceAll(' - Входное тестирование', '').toLowerCase()

        // Нажимаем закрыть вкладку
        await simulateClick(document.querySelector('.v-tabsheet-tabitem-selected .v-tabsheet-caption-close'))
        await wait(500)
        await randomWait()

        // подтверждаем закрытие вкладки
        await attemptToClosePopups()
        await randomWait()

        // Если вкладки всё ещё остались, проходим на них тесты, если нет вкладок, отправляем в background что мы закончили работать
        if (document.querySelectorAll('.v-tabsheet-caption-close').length >= 1) {
            start()
        } else {
            port.postMessage({done: true, topic, error: 'Прохождение ситуационных задач не поддерживается'})
        }
        return
    }

    const buttonNewVariant = document.querySelector('.c-groupbox-content-iom-elementbox-text .v-slot-c-flowlayout .v-button:not([aria-disabled="true"]) .v-button-caption')
    if (!hasSuccessTest && buttonNewVariant && testName !== 'Интерактивные ситуационные задачи') {
        await wait(500)
        // если тест не запущен и нет пройденного, то получаем новый вариант
        await simulateClick(buttonNewVariant)
        // ждём когда появится новый тест и открываем его
        const variant = await watchForText('.c-table-clickable-cell', ' - не завершен')
        await randomWait()
        await simulateClick(variant)
        runTest()
        return
    }

    // Если есть кнопка "Далее" и по кругу перезапускаем данную функцию
    const next = document.querySelector('.v-button-blue-button.v-button-icon-align-right:not([aria-disabled="true"])')
    if (next) {
        nextRepeat++
        if (nextRepeat > 15) {
            stop('Слишком много попыток переключиться на следующий этап (вперёд)')
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
        const correctAnswersElements = document.querySelectorAll('.questionList-item')
        const results = []
        for (const el of correctAnswersElements) {
            const question = {
                question: replaceBadSymbols(el.querySelector('.questionList-item-content-title').textContent).toLowerCase(),
                answers: {
                    type: el.querySelector('.questionList-item-content-question-type')?.textContent?.trim?.(),
                    answers: Array.from(el.querySelectorAll('.questionList-item-content-answer-text')).map(item => replaceBadSymbols(item.textContent).toLowerCase()).sort()
                },
                correct: Boolean(el.querySelector('[svgicon="correct"]')),
                topics: [topic.replaceAll(' - Итоговое тестирование', '').replaceAll(' - Предварительное тестирование', '').replaceAll(' - Входное тестирование', '').toLowerCase()],
                lastOrder: el.querySelector('.questionList-item-number').textContent.trim()
            }
            results.push(question)
        }
        port.postMessage({results})
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

    const question = {
        question: replaceBadSymbols(document.querySelector('.question-title-text').textContent).toLowerCase(),
        answers: {
            type: document.querySelector('.mat-card-question__type').textContent.trim(),
            answers: Array.from(document.querySelectorAll('.question-inner-html-text')).map(item => replaceBadSymbols(item.textContent).toLowerCase()).sort()
        },
        topics: [topic.replaceAll(' - Итоговое тестирование', '').replaceAll(' - Предварительное тестирование', '').replaceAll(' - Входное тестирование', '').toLowerCase()],
        lastOrder: document.querySelector('.question-info-questionCounter').textContent.trim().match(/\d+/)[0]
    }
    port.postMessage({question})
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
            port.postMessage({reloaded: true})
            document.location.reload()
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

        observer.observe(document.documentElement, {
            attributes: true,
            childList: true,
            subtree: true
        })
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
            port.postMessage({reloaded: true})
            document.location.reload()
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

        observer.observe(document.documentElement, {
            attributes: true,
            childList: true,
            subtree: true
        })
    })
}

async function simulateClick(element) {
    element.scrollIntoView({block: 'center'})
    const {x, y} = getRandomCoordinates(element)
    // кликаем именно на элемент который виден в DOM относительно координат
    element = document.elementFromPoint(x, y)
    const {x2, y2} = getRandomCoordinates(element, false)
    element.dispatchEvent(new MouseEvent('mouseover', {bubbles: true, cancelable: true, view: window, clientX: x2, clientY: y2, screenX: x2, screenY: y2}))
    if (simulateUser) await wait(Math.floor(Math.random() * (500 - 100) + 100))
    element.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, buttons: 1, detail: 1}))
    if (simulateUser) await wait(Math.floor(Math.random() * (250 - 50) + 50))
    element.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, buttons: 0, detail: 1}))
    element.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, buttons: 0, detail: 1}))
}

function getRandomCoordinates(element, half = true) {
    // получаем координаты элемента
    const box = element.getBoundingClientRect()
    // вычисляем самую центральную точку элемента
    // const xCenter = (box.left + box.right) / 2
    // const yCenter = (box.top + box.bottom) / 2
    let left = box.left
    let right = box.right
    let top = box.top
    let bottom = box.bottom
    // думаю что это нам ни к чему
    // if (half) {
    //     // сужаем границы координат на половину
    //     left = (left + xCenter) / 2
    //     right = (xCenter + right) / 2
    //     top = (top + yCenter) / 2
    //     bottom = (yCenter + bottom) / 2
    // }
    // генерируем рандомные координаты для клика
    const x = Math.floor(Math.random() * (right - left) + left)
    const y = Math.floor(Math.random() * (bottom - top) + top)
    return {x, y}
}

// супер пупер (наверно) защищённая функция от внешнего детекта на выделение цветом элемента
function highlight(element) {
    const shadow = document.body.attachShadow({mode: 'closed'})
    shadow.append(document.createElement('slot'))
    const div = document.createElement('div')
    const clientRect = element.getBoundingClientRect()
    div.style = `
    position: absolute;
    top: ${clientRect.top}px;
    left: ${clientRect.left}px;
    background: rgb(190 123 9 / 70%);
    width: ${clientRect.width}px;
    height: ${clientRect.height}px;
    z-index: 2147483647;
    pointer-events: none;`
    shadow.prepend(div)
}

// function highlight(element) {
//     const shadow = document.body.attachShadow({mode: 'closed'})
//     shadow.append(document.createElement('slot'))
//     const div = document.createElement('div')
//     const clientRect = element.getBoundingClientRect()
//     div.style.position = 'absolute'
//     div.style.left = clientRect.left + 'px'
//     div.style.top = clientRect.top + 'px'
//     div.style.width = clientRect.width + 'px'
//     div.style.height = clientRect.height + 'px'
//     div.style.background = 'rgb(190 123 9 / 70%)'
//     div.style.zIndex = '2147483647'
//     div.style.position = 'none'
//     shadow.prepend(div)
// }

function stop(error) {
    running = false
    stopRunning = false
    countSaveAnswers = 0
    countAnsweredAnswers = 0
    if (error) {
        port.postMessage({running, collectAnswers: null, error})
    } else {
        port.postMessage({running, collectAnswers: null})
    }
}

function replaceBadSymbols(text) {
    return text.trim().replaceAll('<sup>', '').replaceAll('</sup>', '')
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

async function waitSendAnswer() {
    // здесь дожидаемся когда все http (fetch) запросы save-answers завершатся
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
        }
    }
})
observer.observe({
    entryTypes: ["resource"]
})


// авто открытие теста из плана

// function wait(ms) {
//     return new Promise(resolve => setTimeout(resolve, ms));
// }
// let count = 0
// for (const el of test) {
//     count = count + 1
//     let response = await fetch('https://nmfo-vo.edu.rosminzdrav.ru/api/api/educational-elements/iom/' + el.id + '/open-link?backUrl=https%3A%2F%2Fnmfo-vo.edu.rosminzdrav.ru%2F%23%2Fuser-account%2Fmy-plan', {headers: {authorization: 'Bearer token'}})
//     let json = await response.json()
//     window.open(json.url, '_system')
//     await wait(500)
//     if (count >= 20) break
// }


// авто включение в план
// function wait(ms) {
//     return new Promise(resolve => setTimeout(resolve, ms));
// }
// for (const el of test.elements) {
//     if (el.educationalOrganizationName.includes('НОЧУ')) continue
//     let response = await fetch('https://nmfo-vo.edu.rosminzdrav.ru/api/api/educational-elements/iom/' + el.elementId + '/plan?cycleId=3413b479-f56b-d3fd-724b-46eb6eedba3c', {headers: {authorization: 'Bearer token'}, "method": "PUT"})
//     await response.text()
//     await wait(1000)
// }