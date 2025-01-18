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
