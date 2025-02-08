import * as idb from '/libs/idb.js'
self.idb = idb

document.querySelector('#version').textContent = 'Версия ' + chrome.runtime.getManifest().version

let db, settings
async function init() {
    db = await idb.openDB('nmo', 17)
    self.db = db
    settings = await db.get('other', 'settings')
    self.settings = settings
    await restoreOptions()
    document.querySelector('.loading').style.display = 'none'
    document.querySelector('.main').removeAttribute('style')
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

            blocks.forEach((block) => {
                if (block.getAttribute('data-block').split(' ').includes(el.getAttribute('data-block'))) {
                    block.classList.add('active')
                } else {
                    block.classList.remove('active')
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
    document.querySelector('#GoodScore').addEventListener('change', (event) => {
        settings.goodScore = event.target.checked
        onChangedSettings()
    })
    document.querySelector('#SelectionMethod').addEventListener('change', (event) => {
        settings.selectionMethod = event.target.checked
        onChangedSettings()
    })
    document.querySelector('#TimeoutReloadTabMin').addEventListener('input',  (event) => {
        if (event.target.valueAsNumber !== undefined) {
            settings.timeoutReloadTabMin = event.target.valueAsNumber * 1000
            document.querySelector('#TimeoutReloadTabMax').min = event.target.valueAsNumber
            onChangedSettings()
        }
    })
    document.querySelector('#TimeoutReloadTabMax').addEventListener('input',  (event) => {
        if (event.target.valueAsNumber !== undefined) {
            settings.timeoutReloadTabMax = event.target.valueAsNumber * 1000
            document.querySelector('#TimeoutReloadTabMin').max = event.target.valueAsNumber
            onChangedSettings()
        }
    })
    document.querySelector('#OfflineMode').addEventListener('change', (event) => {
        settings.offlineMode = event.target.checked
        if (settings.offlineMode) document.querySelector('.export-import').removeAttribute('style')
        else document.querySelector('.export-import').style.display = 'none'
        onChangedSettings()
    })
    document.querySelector('#SendResults').addEventListener('change', (event) => {
        if (!event.target.checked) {
            if (!confirm('Отправка ответов позволяет пополнять общую базу (на сервере) новыми ответами, отказываясь от отправки ответов вы отказываетесь от помощи другим врачам (коллегам) которым тоже может понадобиться ответы на новые тесты. В данную отправку не включаются конфиденциальные данные, только сведения о тесте, его вопросах (названия) и ответах. Вы действительно хотите отключить отправку ответов на сервер?')) {
                event.target.checked = !event.target.checked
                return
            }
        }
        settings.sendResults = event.target.checked
        onChangedSettings()
    })

    document.querySelector('#importdb').addEventListener('click', reimportDB)
    document.querySelector('#exportdb').addEventListener('click', exportDB)

    // это просто один большой сплошной костыль заставляющий подобие нашего textarea работать с текстом без форматирования
    document.querySelector('.topics').addEventListener('paste', (event) => {
        const text = event.clipboardData.getData('text/plain').replaceAll('\t', ' ')
        event.preventDefault()
        document.execCommand('insertText', false, text)
    })
    const elTopics = document.querySelector('.topics')
    let oldValueTopics = elTopics.innerHTML
    let savedCursor
    elTopics.addEventListener('input', () => {
        if (!elTopics.innerHTML) {
            elTopics.append(document.createElement('li'))
            return
        }
        if (oldValueTopics === elTopics.innerHTML) {
            if (savedCursor) {
                setCursorIndex(elTopics, savedCursor)
                savedCursor = null
            }
            return
        }
        elTopics.removeAttribute('style')
        let maxWidth = 0
        for (const [index, li] of Array.from(elTopics.children).entries()) {
            li.removeAttribute('style')
            li.removeAttribute('id')
            if (li.getAttribute('data-before') == null) li.setAttribute('data-before', '')
            li.removeAttribute('data-tooltip')
            while (li.firstElementChild?.tagName === 'BR') {
                li.firstElementChild.remove()
            }
            if (li.firstElementChild) {
                if (!savedCursor) savedCursor = getCursorIndex(elTopics)
                const source = li
                const destination = source.parentElement
                const referenceElement = source.previousElementSibling
                const fragment = document.createDocumentFragment()
                for (const text of li.innerText.split('\n')) {
                    const li2 = document.createElement('li')
                    li2.textContent = text
                    fragment.append(li2)
                }
                if (referenceElement) {
                    destination.insertBefore(fragment, referenceElement.nextSibling)
                } else {
                    if (index === 0) {
                        destination.prepend(fragment)
                    } else {
                        destination.append(fragment)
                    }
                }
                source.remove()
                elTopics.dispatchEvent(new Event('input', { bubbles: true }))
                return
            }
            if (li.innerHTML.replaceAll('&nbsp;', ' ').replaceAll('\r', '') !== li.innerText) {
                if (!savedCursor) savedCursor = getCursorIndex(elTopics)
                li.innerHTML = li.innerText
            }
            if (!li.innerText) li.setAttribute('data-before', '')
            maxWidth = Math.max(li.clientWidth, maxWidth)
        }

        elTopics.style.setProperty('--width', maxWidth + 'px')

        if (savedCursor) {
            setCursorIndex(elTopics, savedCursor)
            savedCursor = null
        }

        updateTopics(elTopics)

        oldValueTopics = elTopics.innerHTML
    })
    elTopics.addEventListener('beforeinput', (event) => {
        if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
            event.preventDefault()
        }
    })
    let maxWidth = 0
    for (const li of elTopics.children) {
        maxWidth = Math.max(li.clientWidth, maxWidth)
    }
    elTopics.style.setProperty('--width', maxWidth + 'px')

    elTopics.addEventListener('click', async (event) => {
        // console.log(event.target, event.offsetX)
        if (event.offsetX > 20) return
        const topic = await db.get('topics', isNaN(event.target.id) ? event.target.id : Number(event.target.id))
        if (!topic) return
        if (topic.completed) {
            topic.completed = 0
            delete topic.error
            event.target.setAttribute('data-before', '')
            event.target.removeAttribute('data-tooltip')
            await db.put('topics', topic)
        }
    })

    document.querySelector('#ImportFromSite').addEventListener('click', async (event) => {
        const elButton = event.target
        if (elButton.disabled) return
        try {
            elButton.disabled = true
            elButton.textContent = 'Импортируем...'
            const authData = await db.get('other', 'authData')
            const cabinet = await db.get('other', 'cabinet')
            if (!authData?.access_token || !cabinet) {
                throw Error('Ошибка, нет данных об авторизации, зайдите и авторизуйте на портале или обновите страницу портала')
            }
            for (let i=2; i--;) {
                let response = await fetch('https://' + cabinet + '.edu.rosminzdrav.ru/api/api/profile/schedule/load-iom?offset=0&hasGap=' + (i === 1 ? 'true' : 'false'), {headers: {authorization: 'Bearer ' + authData.access_token}})
                if (String(response.status).startsWith('5')) {
                    throw Error('Ошибка, портал не может ответить на запрос, код ошибки ' + String(response.status) + ' ' + response.statusText)
                }
                let json = await response.json()
                if (json.error_description?.includes('token expired') || json.error_description?.includes('access token')) {
                    throw Error('Ошибка, данные авторизации устарели, зайдите и авторизуйте на портале или обновите страницу портала')
                }
                const topicsStore = db.transaction('topics', 'readwrite').store
                for (const ee of json) {
                    if (ee.status !== 'included') continue
                    const name = ee.elementName || ee.elementTitle || ee.elementId
                    if (elTopics.innerText.includes(name)) continue
                    const object = {id: ee.elementId, name: normalizeText(ee.elementName || ee.elementTitle), dirty: 1}
                    await putNewTopic(object, topicsStore)
                    const li = document.createElement('li')
                    li.textContent = name
                    elTopics.append(li)
                }
            }
            alert('Успешно импортировано')
        } catch (error) {
            console.error(error)
            alert(error)
        } finally {
            elButton.disabled = false
            elButton.textContent = 'Импортировать темы'
            elTopics.dispatchEvent(new Event('input', { bubbles: true }))
        }
    })
})

chrome.runtime.onMessage.addListener((message) => {
    if (message.updatedTopic) {
        let li = document.getElementById(message.updatedTopic._id)
        if (!li && message.updatedTopic.inputIndex != null) {
            li = document.querySelector('.topics li:nth-child(' + message.updatedTopic.inputIndex + ')')
        }
        if (!li || li.innerText.trim() !== message.updatedTopic.inputName) {
            const result = document.evaluate(`//*[text() = '${message.updatedTopic.inputName}']`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
            if (result?.singleNodeValue) li = result.singleNodeValue
        }
        if (li) {
            li.id = message.updatedTopic._id
            updateTopic(message.updatedTopic, li)
        }
    }
})

async function restoreOptions() {
    const nav_btns = document.querySelectorAll('nav button')
    const blocks = document.querySelectorAll('div.block')
    blocks.forEach((block) => {
        block.classList.remove('active')
        if (block.getAttribute('data-block').split(' ').includes(settings.mode)) {
            block.classList.add('active')
        } else {
            block.classList.remove('active')
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
    document.querySelector('#GoodScore').checked = settings.goodScore
    document.querySelector('#SelectionMethod').checked = settings.selectionMethod
    document.querySelector('#TimeoutReloadTabMin').value = settings.timeoutReloadTabMin / 1000
    document.querySelector('#TimeoutReloadTabMin').max = settings.timeoutReloadTabMax / 1000
    document.querySelector('#TimeoutReloadTabMax').value = settings.timeoutReloadTabMax / 1000
    document.querySelector('#TimeoutReloadTabMax').min = settings.timeoutReloadTabMin / 1000
    document.querySelector('#OfflineMode').checked = settings.offlineMode
    if (settings.offlineMode) document.querySelector('.export-import').removeAttribute('style')
    else document.querySelector('.export-import').style.display = 'none'
    document.querySelector('#SendResults').checked = settings.sendResults

    await restoreTopics()
}

function getCursorIndex(element) {
    const selection = window.getSelection()
    if (selection.rangeCount === 0) return 0

    const range = selection.getRangeAt(0)
    const preCursorRange = range.cloneRange()
    preCursorRange.selectNodeContents(element)
    preCursorRange.setEnd(range.startContainer, range.startOffset)

    return preCursorRange.toString().length
}

function setCursorIndex(element, index) {
    const selection = window.getSelection()
    const range = document.createRange()

    let charCount = 0
    let found = false

    function traverseNodes(node) {
        if (found) return

        if (node.nodeType === Node.TEXT_NODE) {
            const textLength = node.textContent.length
            if (charCount + textLength >= index) {
                range.setStart(node, index - charCount)
                range.collapse(true)
                found = true
            } else {
                charCount += textLength
            }
        } else {
            for (let child of node.childNodes) {
                traverseNodes(child)
            }
        }
    }

    traverseNodes(element)
    if (!found) return // Если не удалось найти позицию

    selection.removeAllRanges()
    selection.addRange(range)
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

async function restoreTopics() {
    const inputIndex = db.transaction('topics').store.index('inputIndex')
    const fragment = document.createDocumentFragment()
    // noinspection JSUnresolvedReference
    for await (const cursor of inputIndex.iterate()) {
        const topic = cursor.value
        const li = document.createElement('li')
        li.innerText = topic.inputName
        updateTopic(topic, li)
        li.id = topic._id
        fragment.append(li)
    }
    if (!fragment.childElementCount) fragment.append(document.createElement('li'))
    const elTopics = document.querySelector('.topics')
    elTopics.replaceChildren()
    elTopics.append(fragment)
}

function updateTopic(topic, element) {
    if (topic.completed === 1) {
        element.setAttribute('data-before', '✅')
    } else if (topic.completed === 2) {
        element.setAttribute('data-before', '❌')
    } else {
        element.setAttribute('data-before', '')
    }
    if (topic.error) {
        element.setAttribute('data-tooltip', topic.error)
    } else {
        element.removeAttribute('data-tooltip')
    }
}

let topicsTimer
let topicsFunc
async function updateTopics(elTopics, skipTimer) {
    // подобным образом мы хоть как-то оптимизируем обновление списка
    if (!skipTimer) {
        clearTimeout(topicsTimer)
        topicsTimer = setTimeout(() => {
            topicsFunc = updateTopics(elTopics, true)
            topicsFunc.finally(() => topicsFunc.done = true)
        }, 250)
        return
    }
    if (topicsFunc && !topicsFunc.done) {
        updateTopics(elTopics)
    }

    const topicsStore = db.transaction('topics', 'readwrite').store

    const dirty = topicsStore.index('dirty')
    // noinspection JSUnresolvedReference
    for await (const cursor of dirty.iterate(1)) {
        await cursor.delete()
    }

    const completed = topicsStore.index('completed')
    // noinspection JSUnresolvedReference
    for await (const cursor of completed.iterate(0)) {
        const topic = cursor.value
        delete topic.completed
        delete topic.inputIndex
        delete topic.inputName
        await cursor.update(topic)
    }

    const inputIndex = topicsStore.index('inputIndex')
    // noinspection JSUnresolvedReference
    for await (const cursor of inputIndex.iterate(IDBKeyRange.lowerBound(0))) {
        const topic = cursor.value
        if (topic.completed === 0) delete topic.completed
        delete topic.inputIndex
        delete topic.inputName
        await cursor.update(topic)
    }

    let index = 0
    for (const li of elTopics.children) {
        const text = li.innerText.trim()
        if (!text) continue

        index++
        const ee = text.split(/\t/)
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
            topic = await topicsStore.index('id').get(object.id)
        }
        if (!topic && object.code) {
            topic = await topicsStore.index('code').get(object.code)
        }
        if (!topic && object.name) {
            topic = await topicsStore.index('name').get(object.name)
        }
        if (topic) {
            if (topic.completed == null) topic.completed = 0
            topic.inputIndex = index
            topic.inputName = text
            if (object.id && !topic.id) {
                topic.id = object.id
            }
            if (object.code && !topic.code) {
                topic.code = object.code
            }
            if (object.name && !topic.name) {
                topic.name = object.name
            }
            updateTopic(topic, li)
            // console.log('Обновлён', topic)
        } else {
            topic = object
            topic.completed = 0
            topic.inputIndex = index
            topic.inputName = text
            topic.dirty = 1
            updateTopic(topic, li)
            // console.log('Добавлен', topic)
        }
        const key = await topicsStore.put(topic)
        li.id = key
    }
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/*Звезды на кнопке доната*/
// const fadeInt = setInterval(makeStar, 1500)
function makeStar() {
    const newstar = document.createElement('div')
    newstar.style.backgroundColor = '#fff'
    newstar.style.borderRadius = '50%'
    newstar.style.position = 'absolute'
    newstar.style.top = Math.random()*100 + '%'
    newstar.style.left = Math.random()*100 + '%'
    newstar.style.height = Math.random()*3 + 'px'
    newstar.style.width = newstar.style.height
    newstar.classList.add('star')
    const glow = Math.random()*10
    newstar.style.boxShadow = '0 0 ' + glow + 'px' + " " + glow/2 + 'px yellow'
    newstar.style.animationDuration = Math.random()*3+0.5 + 's'
    document.querySelector('#donate').appendChild(newstar)

    const stArr = document.querySelectorAll('.star')
    if (stArr.length >= 100) {
        clearInterval(fadeInt)
    }
}


async function reimportDB(event) {
    const target = event?.target || document.querySelector('#importdb')
    if (target.disabled) return
    target.disabled = true
    const status = target.parentElement.querySelector('.status')
    let hasError = false
    try {
        const result = await showOpenFilePicker({types: [{accept: {'application/json': '.json'}}]})
        setStatus('Считываем указанный файл...')
        const file = await result[0].getFile()
        const data = await new Response(file).json()

        const transaction = db.transaction(['questions', 'topics'], 'readwrite')
        const questionsStore = transaction.objectStore('questions')
        const topicsStore = transaction.objectStore('topics')

        setStatus('Очищаем бд...')
        await questionsStore.clear()
        await topicsStore.clear()

        const promises = []
        let progress = 0
        let lastShow
        let maxProgress = (data.questions.length + data.topics.length) * 2
        function onComplete() {
            if (hasError) return
            progress++
            if (!lastShow || Date.now() - lastShow >= 500) {
                const percent = ((Math.floor((100 * progress / maxProgress) * 10) / 10) || 0).toFixed(1)
                setStatus('Прогресс ' + percent + '%   ' + ((progress / 2) | 0).toLocaleString('ru') + ' / ' + ((maxProgress / 2) | 0).toLocaleString('ru'))
                lastShow = Date.now()
            }
        }

        setStatus('Заносим в базу темы...')
        for (const topic of data.topics) {
            const promise = topicsStore.put(topic)
            promises.push(promise)
            promise.finally(onComplete)
            onComplete()
            // TODO таким вот тупорылым костылём мы избавляемся от провисания
            if (progress % 10000 === 0) {
                await topicsStore.get(0)
            }
        }

        setStatus('Заносим в базу вопросы...')
        for (const question of data.questions) {
            const promise = questionsStore.add(question)
            promises.push(promise)
            promise.finally(onComplete)
            onComplete()
            // TODO таким вот тупорылым костылём мы избавляемся от провисания
            if (progress % 10000 === 0) {
                await questionsStore.get(0)
            }
        }
        setStatus('Ожидаем когда в бд всё будет занесено')

        await Promise.all(promises)

        lastShow = null
        onComplete()
        setStatus('готово')
    } catch (error) {
        console.error(error)
        hasError = true
        status.textContent = error.message
    } finally {
        target.disabled = false
    }

    function setStatus(text) {
        status.textContent = text
        console.log(text)
    }
}
self.reimportDB = reimportDB

async function exportDB(event) {
    const target = event?.target || document.querySelector('#importdb')
    if (target.disabled) return
    target.disabled = true
    const status = target.parentElement.querySelector('.status')
    try {
        setStatus('Экспортирование дб...')
        setStatus('Экспорт questions...')
        const questions = await db.getAll('questions')
        setStatus('Экспорт topics...')
        const topics = await db.getAll('topics')
        setStatus('Преобразование в json...')
        const text = JSON.stringify({questions, topics})
        const blob = new Blob([text],{type: 'text/json;charset=UTF-8;'})
        const anchor = document.createElement('a')

        anchor.download = 'nmo_db.json'
        anchor.href = (window.webkitURL || window.URL).createObjectURL(blob)
        anchor.dataset.downloadurl = ['text/json;charset=UTF-8;', anchor.download, anchor.href].join(':')
        setStatus('Скачивание...')
        anchor.click()
        setStatus('Готово')
    } catch (error) {
        console.error(error)
        status.textContent = error.message
    } finally {
        target.disabled = false
    }

    function setStatus(text) {
        status.textContent = text
        console.log(text)
    }
}
self.exportDB = exportDB

