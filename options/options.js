import * as idb from '/libs/idb.js'
self.idb = idb

let db, settings, resolveInit
async function init() {
    // noinspection JSVoidFunctionReturnValueUsed
    const response = await chrome.runtime.sendMessage({status: true})
    if (response.initializing) {
        document.querySelector('#LoadingText').style.display = 'none'
        document.querySelector('#initializing').removeAttribute('style')
        await new Promise(resolve => resolveInit = resolve)
    }
    db = await idb.openDB('nmo', 14)
    self.db = db
    settings = await db.get('other', 'settings')
    self.settings = settings
    await restoreOptions()
    document.querySelector('.loading').style.display = 'none'
    document.querySelector('.main').removeAttribute('style')
    if (response.initializing) {
        await wait(500)
        alert('Расширение успешно прошёл инициализацию, можете открывать тесты')
    }
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

    const exportDbStatus = document.querySelector('label[for="exportdb"] .status')
    let exporting = false
    document.querySelector('#exportdb').addEventListener('click', async () => {
        if (exporting) return
        exporting = true
        try {
            exportDbStatus.textContent = 'Экспортирование бд...'
            const questions = await db.getAllFromIndex('questions', 'newChange', IDBKeyRange.lowerBound(1))
            const topics = await db.getAllFromIndex('topics', 'newChange', IDBKeyRange.lowerBound(1))
            if (!questions.length) {
                exportDbStatus.innerText = 'Экспортировать нечего\nв вашей базе нет новых изменений'
                return
            }
            const text = JSON.stringify({questions, topics})
            const blob = new Blob([text],{type: 'text/json;charset=UTF-8;'})
            const anchor = document.createElement('a')

            anchor.download = 'nmo_db.json'
            anchor.href = (window.webkitURL || window.URL).createObjectURL(blob)
            anchor.dataset.downloadurl = ['text/json;charset=UTF-8;', anchor.download, anchor.href].join(':')
            anchor.click()
            exportDbStatus.textContent = 'Готово'
        } catch (error) {
            console.error(error)
            exportDbStatus.innerText = 'Произошла ошибка:\n' + error.message
        } finally {
            exporting = false
        }
    })

    const importDbStatus = document.querySelector('label[for="importdb"] .status')
    let importing = false
    document.querySelector('#importdb').addEventListener('change', async (event) => {
        if (importing) return
        importing = true
        let transaction
        try {
            if (event.target.files.length === 0) return
            importDbStatus.innerText = 'Импортируем...'
            const [file] = event.target.files
            const data = await new Response(file).json()
            transaction = db.transaction(['questions', 'topics'], 'readwrite')
            await joinDB(data, transaction, importDbStatus)
        } catch (error) {
            console.error(error)
            importDbStatus.innerText = 'Произошла ошибка:\n' + error.message
            if (transaction) transaction.abort()
        } finally {
            document.querySelector('#importdb').value = ''
            importing = false
        }
    }, false)

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
    await updateStats()
}

async function updateStats() {
    const newAnswers = await db.countFromIndex('questions', 'newChange', 2)
    const newChangesQuestions = await db.countFromIndex('questions', 'newChange', 1)
    const newChangesTopics = await db.countFromIndex('topics', 'newChange', 2)
    const newChanges = newChangesQuestions + newChangesTopics
    const newTopics = await db.countFromIndex('topics', 'newChange', 1)
    document.querySelector('label[for="exportdb"] .status').innerText = `Кол-во изменений в вашей бд:\nНовых ответов ${newAnswers}\nНовых изменений ${newChanges}\nНовых тем ${newTopics}`
}
self.updateStats = updateStats

chrome.runtime.onMessage.addListener((message) => {
    if (message.initStage) {
        document.querySelector('#LoadingText').style.display = 'none'
        document.querySelector('#initializing').removeAttribute('style')
        const initStage = message.initStage
        document.querySelector('#percent1').innerText = `Прогресс ${initStage.stage1.percent}%`
        document.querySelector('#progress1').innerText = `Загружено ${initStage.stage1.current.toLocaleString('ru')}/${initStage.stage1.max.toLocaleString('ru')}`
        document.querySelector('#percent2').innerText = `Прогресс ${initStage.stage2.percent}%`
        document.querySelector('#progress2').innerText = `Загружено ${initStage.stage2.current.toLocaleString('ru')}/${initStage.stage2.max.toLocaleString('ru')}`
        document.querySelector('#percent3').innerText = `Прогресс ${initStage.stage3.percent}%`
        document.querySelector('#progress3').innerText = `Загружено ${initStage.stage3.current.toLocaleString('ru')}/${initStage.stage3.max.toLocaleString('ru')}`
        if (initStage.stage3.current && initStage.stage3.current === initStage.stage3.max) {
            if (resolveInit) {
                resolveInit()
            } else {
                document.location.reload()
            }
        }
    }
})

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

