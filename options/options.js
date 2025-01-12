import * as idb from '/libs/idb.js'
self.idb = idb

let db, settings, resolveInit
async function init() {
    db = await idb.openDB('nmo', 15)
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
    let timer
    nav_btns.forEach((el)=> {
        el.addEventListener('click', () => {
            const mode = el.getAttribute('data-block')
            if (mode === 'auto') {
                el.textContent = 'В разработке'
                clearTimeout(timer)
                timer = setTimeout(() => {
                    el.textContent = 'Автоматический'
                }, 3000)
                return
            }

            blocks.forEach((block) => {
                block.classList.remove('active')
                const dataBlock = block.getAttribute('data-block')
                if (dataBlock === el.getAttribute('data-block')) {
                    block.classList.add('active')
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
})

async function restoreOptions() {
    const nav_btns = document.querySelectorAll('nav button')
    const blocks = document.querySelectorAll('div.block')
    blocks.forEach((block) => {
        block.classList.remove('active')
        const dataBlock = block.getAttribute('data-block')
        if (dataBlock === settings.mode) {
            block.classList.add('active')
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
    document.querySelector('#TimeoutReloadTabMin').value = settings.timeoutReloadTabMin / 1000
    document.querySelector('#TimeoutReloadTabMin').max = settings.timeoutReloadTabMax / 1000
    document.querySelector('#TimeoutReloadTabMax').value = settings.timeoutReloadTabMax / 1000
    document.querySelector('#TimeoutReloadTabMax').min = settings.timeoutReloadTabMin / 1000
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

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

