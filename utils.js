async function toggleVisibleScript() {
    const scripts = await chrome.scripting.getRegisteredContentScripts({ids: ['visible-script']})
    // TODO следует более адекватно решить проблему с работой в фоновом режиме
    if ((settings.mode === 'semi-auto' || settings.mode === 'auto')/* && settings.answerWaitMax <= 500 && settings.clickWaitMax <= 500*/) {
        if (!scripts.length) {
            await chrome.scripting.registerContentScripts([{
                id: 'visible-script',
                js: ['content-scripts/visible.js'],
                matches: ['https://*.edu.rosminzdrav.ru/quiz-wrapper/*'],
                world: 'MAIN',
                runAt: 'document_start'
            }])
        }
    } else {
        if (scripts.length) {
            await chrome.scripting.unregisterContentScripts({ids: ['visible-script']})
        }
    }
}
self.toggleVisibleScript = toggleVisibleScript

async function toggleContentScript() {
    const scripts = await chrome.scripting.getRegisteredContentScripts({ids: ['content-script']})
    if (settings.mode !== 'disabled') {
        if (!scripts.length) {
            await chrome.scripting.registerContentScripts([{
                id: 'content-script',
                js: ['normalize-text.js', 'content-scripts/content-script.js'],
                matches: ['https://*.edu.rosminzdrav.ru/*']
            }])
            if (self.window) {
                const tabs = await chrome.tabs.query({url: 'https://*.edu.rosminzdrav.ru/*'})
                for (const tab of tabs) {
                    if (tab.status === 'complete') {
                        chrome.scripting.executeScript({files: ['normalize-text.js', 'content-scripts/content-script.js'], target: {tabId: tab.id}})
                    }
                }
            }
        }
    } else {
        if (scripts.length) {
            await chrome.scripting.unregisterContentScripts({ids: ['content-script']})
            if (self.window) {
                const tabs = await chrome.tabs.query({url: 'https://*.edu.rosminzdrav.ru/*'})
                for (const tab of tabs) {
                    if (tab.status === 'complete') {
                        chrome.tabs.reload(tab.id)
                    }
                }
            }
        }
    }
}
self.toggleContentScript = toggleContentScript

async function toggleRuleSet() {
    const rules = await chrome.declarativeNetRequest.getEnabledRulesets()
    if (settings.mode === 'manual' || settings.mode === 'disabled') {
        if (rules.length && !self.window) {
            await chrome.declarativeNetRequest.updateEnabledRulesets({disableRulesetIds: ['ruleset_1']})
        }
    } else {
        if (!rules.length) {
            await chrome.declarativeNetRequest.updateEnabledRulesets({enableRulesetIds: ['ruleset_1']})
        }
    }
}
self.toggleRuleSet = toggleRuleSet

async function putNewTopic(newTopic, topicsStore) {
    delete newTopic.dirty
    if (!topicsStore) topicsStore = db.transaction('topics', 'readwrite').store
    let topic, changed
    if (newTopic.id) {
        topic = await topicsStore.index('id').get(newTopic.id)
    }
    if (!topic && newTopic.code) {
        topic = await topicsStore.index('code').get(newTopic.code)
    }
    if (!topic && newTopic.name) {
        topic = await topicsStore.index('name').get(newTopic.name)
    }
    if (!topic) {
        newTopic._id = await topicsStore.put(newTopic)
        return newTopic
    }
    if (newTopic.id && topic.id !== newTopic.id) {
        changed = true
        topic.id = newTopic.id
        const oldTopic = await topicsStore.index('id').get(topic.id)
        if (oldTopic && oldTopic._id !== topic._id) {
            topic = joinTopics(topic, oldTopic)
            await topicsStore.delete(oldTopic._id)
            console.warn('Удалён дублирующий topic', JSON.stringify(oldTopic))
        }
    }
    if (newTopic.code && topic.code !== newTopic.code) {
        changed = true
        topic.code = newTopic.code
        const oldTopic = await topicsStore.index('code').get(topic.code)
        if (oldTopic && oldTopic._id !== topic._id) {
            topic = joinTopics(topic, oldTopic)
            await topicsStore.delete(oldTopic._id)
            console.warn('Удалён дублирующий topic', JSON.stringify(oldTopic))
        }
    }
    if (newTopic.name && topic.name !== newTopic.name) {
        changed = true
        topic.name = newTopic.name
        const oldTopic = await topicsStore.index('name').get(topic.name)
        if (oldTopic && oldTopic._id !== topic._id) {
            topic = joinTopics(topic, oldTopic)
            await topicsStore.delete(oldTopic._id)
            console.warn('Удалён дублирующий topic', JSON.stringify(oldTopic))
        }
    }
    if (newTopic.inputName && topic.inputName !== newTopic.inputName) {
        changed = true
        topic.inputName = newTopic.inputName
    }
    if (newTopic.inputIndex != null && topic.inputIndex !== newTopic.inputIndex) {
        changed = true
        topic.inputIndex = newTopic.inputIndex
    }
    if (newTopic.completed != null && topic.completed !== newTopic.completed) {
        changed = true
        topic.completed = newTopic.completed
    }
    if (newTopic.error != null && topic.error !== newTopic.error) {
        changed = true
        topic.error = newTopic.error
    }
    if (changed) {
        console.log('Объединён topic', topic)
        await topicsStore.put(topic)
    }
    return topic
}
self.putNewTopic = putNewTopic

function joinTopics(oldTopic, newTopic) {
    delete oldTopic.dirty
    delete newTopic.dirty
    if (!oldTopic.id && newTopic.id) {
        oldTopic.id = newTopic.id
    }
    if (!oldTopic.code && newTopic.code) {
        oldTopic.code = newTopic.code
    }
    if (!oldTopic.name && newTopic.name) {
        oldTopic.name = newTopic.name
    }
    if (!oldTopic.inputName && newTopic.inputName) {
        oldTopic.inputName = newTopic.inputName
    }
    if (oldTopic.inputIndex == null && newTopic.inputIndex != null) {
        oldTopic.inputIndex = newTopic.inputIndex
    }
    if (oldTopic.completed == null && newTopic.completed != null) {
        oldTopic.completed = newTopic.completed
    }
    if (oldTopic.error == null && newTopic.error != null) {
        oldTopic.error = newTopic.error
    }
    return oldTopic
}
self.joinTopics = joinTopics
