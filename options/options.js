import * as idb from '/libs/idb.js'
self.idb = idb

let db, settings, resolveInit
async function init() {
    db = await idb.openDB('nmo', 16)
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
                const dataBlock = block.getAttribute('data-block')
                if (dataBlock === el.getAttribute('data-block') || (dataBlock === 'semi-auto' && 'auto' === el.getAttribute('data-block'))) {
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
        onChangedSettings()
    })

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
            // li.removeAttribute('data-before')
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
            if (!li.innerText) li.removeAttribute('data-before')
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
        console.log(event.target, event.offsetX)
        if (event.offsetX > 30) return
        const topic = await db.get('topics', isNaN(event.target.id) ? event.target.id : Number(event.target.id))
        if (!topic) return
        if (topic.completed) {
            topic.completed = 0
            delete topic.error
            event.target.removeAttribute('data-before')
            event.target.removeAttribute('data-tooltip')
            await db.put('topics', topic)
        }
    })
})

chrome.runtime.onMessage.addListener((message) => {
    if (message.updatedTopic) {
        const li = document.getElementById(message.updatedTopic._id)
        if (li) {
            updateTopic(message.updatedTopic, li)
        }
    }
})

async function restoreOptions() {
    const nav_btns = document.querySelectorAll('nav button')
    const blocks = document.querySelectorAll('div.block')
    blocks.forEach((block) => {
        block.classList.remove('active')
        const dataBlock = block.getAttribute('data-block')
        if (dataBlock === settings.mode || (dataBlock === 'semi-auto' && 'auto' === settings.mode)) {
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
    if (settings.goodScore) document.querySelector('#GoodScore').parentElement.removeAttribute('style')
    document.querySelector('#SelectionMethod').checked = settings.selectionMethod
    document.querySelector('#TimeoutReloadTabMin').value = settings.timeoutReloadTabMin / 1000
    document.querySelector('#TimeoutReloadTabMin').max = settings.timeoutReloadTabMax / 1000
    document.querySelector('#TimeoutReloadTabMax').value = settings.timeoutReloadTabMax / 1000
    document.querySelector('#TimeoutReloadTabMax').min = settings.timeoutReloadTabMin / 1000
    document.querySelector('#OfflineMode').checked = settings.offlineMode
    if (settings.offlineMode) document.querySelector('#OfflineMode').parentElement.removeAttribute('style')

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
        element.removeAttribute('data-before')
    }
    if (topic.error) {
        element.setAttribute('data-tooltip', topic.error)
    } else {
        element.removeAttribute('data-tooltip')
    }
}

async function updateTopics(elTopics) {
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

    for (const [index, li] of Array.from(elTopics.children).entries()) {
        const text = li.innerText.trim()
        if (!text) continue

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
            console.log('Обновлён', topic)
        } else {
            topic = object
            topic.completed = 0
            topic.inputIndex = index
            topic.inputName = text
            topic.dirty = 1
            updateTopic(topic, li)
            console.log('Добавлен', topic)
        }
        const key = await topicsStore.put(topic)
        li.id = key
    }
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/*Звезды на кнопке доната*/
let rand = Math.random()
let map = document.querySelector('#donate')

function makeStar() {
    let newstar = document.createElement('div')
    newstar.style.backgroundColor = '#fff'
    newstar.style.borderRadius = '50%'
    newstar.style.position = 'absolute'
    newstar.style.top = Math.random()*100 + '%'
    newstar.style.left = Math.random()*100 + '%'
    newstar.style.height = Math.random()*3 + 'px'
    newstar.style.width = newstar.style.height
    newstar.classList.add('star')
    let glow = Math.random()*10
    newstar.style.boxShadow = '0 0 ' + glow + 'px' + " " + glow/2 + 'px yellow'
    newstar.style.animationDuration = Math.random()*3+0.5 + 's'
    map.appendChild(newstar)

    let stArr = document.querySelectorAll('.star')
    if (stArr.length >= 100){
        clearInterval(fadeInt)
    }
}

let fadeInt = setInterval(makeStar, 1500)
