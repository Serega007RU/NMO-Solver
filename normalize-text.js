const LATIN_TO_VIEW_CYRILLIC_NEW = {
    'Α': 'А', //   913	U+0391	CE 91	Α	Greek Capital Letter Alpha
    'Β': 'В', //   914	U+0392	CE 92	Β	Greek Capital Letter Beta
    'Γ': 'Г', //   915	U+0393	CE 93	Γ	Greek Capital Letter Gamma
    'Ε': 'Е', //   917	U+0395	CE 95	Ε	Greek Capital Letter Epsilon
    'Η': 'Н', //   919	U+0397	CE 97	Η	Greek Capital Letter Eta
    'Κ': 'К', //   922	U+039A	CE 9A	Κ	Greek Capital Letter Kappa
    'Λ': 'Л', //   923	U+039B	CE 9B	Λ	Greek Capital Letter Lamda
    'Μ': 'М', //   924	U+039C	CE 9C	Μ	Greek Capital Letter Mu
    'Ο': 'О', //   927	U+039F	CE 9F	Ο	Greek Capital Letter Omicron
    'Π': 'П', //   928	U+03A0	CE A0	Π	Greek Capital Letter Pi
    'Ρ': 'Р', //   929	U+03A1	CE A1	Ρ	Greek Capital Letter Rho
    'Τ': 'Т', //   932	U+03A4	CE A4	Τ	Greek Capital Letter Tau
    'Φ': 'Ф', //   934	U+03A6	CE A6	Φ	Greek Capital Letter Phi
    'Χ': 'Х', //   935	U+03A7	CE A7	Χ	Greek Capital Letter Chi
    'κ': 'к', //   954	U+03BA	CE BA	κ	Greek Small Letter Kappa
    'ο': 'о', //   959	U+03BF	CE BF	ο	Greek Small Letter Omicron
    'ρ': 'р', //   961	U+03C1	CF 81	ρ	Greek Small Letter Rho
    'ς': 'с', //   962	U+03C2	CF 82	ς	Greek Small Letter Final Sigma
    'χ': 'х', //   967	U+03C7	CF 87	χ	Greek Small Letter Chi
    'ϐ': 'в', //   976	U+03D0	CF 90	ϐ	Greek Beta Symbol
    'ϒ': 'у', //   978	U+03D2	CF 92	ϒ	Greek Upsilon With Hook Symbol
    'ϕ': 'ф', //   981	U+03D5	CF 95	ϕ	Greek Phi Symbol
    'Ϧ': 'ь', //   998	U+03E6	CF A6	Ϧ	Coptic Capital Letter Khei
    'Ϲ': 'С', //   1017	U+03F9	CF B9	Ϲ	Greek Capital Lunate Sigma Symbol
    'Ϻ': 'М', //   1018	U+03FA	CF BA	Ϻ	Greek Capital Letter San
    'Ҋ': 'Й', //   1162	U+048A	D2 8A	Ҋ	Cyrillic Capital Letter Short I With Tail
    'ҋ': 'й', //   1163	U+048B	D2 8B	ҋ	Cyrillic Small Letter Short I With Tail

    'ͣ': 'а', // 867	U+0363	CD A3	ͣ	Combining Latin Small Letter A
    'Ƃ': 'Б', //386	U+0182	C6 82	Ƃ	Latin Capital Letter B With Topbar
    'ʙ': 'в', // 665	U+0299	CA 99	ʙ	Latin Letter Small Capital B
    'ͤ': 'е', // 868	U+0364	CD A4	ͤ	Combining Latin Small Letter E
    'Ȅ': 'Ё', // 516	U+0204	C8 84	Ȅ	Latin Capital Letter E With Double Grave
    'ȅ': 'ё', // 517	U+0205	C8 85	ȅ	Latin Small Letter E With Double Grave
    'Ʒ': 'З', // 439	U+01B7	C6 B7	Ʒ	Latin Capital Letter Ezh
    'Ͷ': 'И', // 886	U+0376	CD B6	Ͷ	Greek Capital Letter Pamphylian Digamma
    'ͷ': 'и', // 887	U+0377	CD B7	ͷ	Greek Small Letter Pamphylian Digamma
    'ĸ': 'к', // 312	U+0138	C4 B8	ĸ	Latin Small Letter Kra
    'ʜ': 'Н',  // 668	U+029C	CA 9C	ʜ	Latin Letter Small Capital H
    'ȏ': 'о', // 527	U+020F	C8 8F	ȏ	Latin Small Letter O With Inverted Breve
    'ͦ': 'о', // 870	U+0366	CD A6	ͦ	Combining Latin Small Letter O
    'ͨ': 'с', // 872	U+0368	CD A8	ͨ	Combining Latin Small Letter C
    // 882	U+0372	CD B2	Ͳ	Greek Capital Letter Archaic Sampi
    // 883	U+0373	CD B3	ͳ	Greek Small Letter Archaic Sampi
    // исправление неверно использованных символах
    'Ţ': 'Т', // 354	U+0162	C5 A2	Ţ	Latin Capital Letter T With Cedilla
    'і': 'i',
    'Ϗ': 'К', // Символ Ϗ (U+03CF) — это стилизованное заглавное написание греческого слова "και" (kai), что означает "и" в греческом языке.
    'º': '°', // градус цельсия
    '◦': '°',
    '⁓': '~', // topic 678270b4b100db787f87d5ab, question 678270b5b100db787f89fb46
    '±': '+',
    '⁄': '/',
    '÷': '/',
    '‰': '%',
    '≡': '=',
    '˟': '×',
    '·': '×',
    '∙': '×',
    '•': '×',
    'ɑ': 'а', //         U+03B1	GREEK SMALL LETTER ALPHA
    '⍺': 'а',
    '≥': '>',
    '≤': '<',
    '≧': '>',
    '≦': '<',
    '˂': '<',
    '˃': '>',
    '⩽': '<',
    '⩾': '>',
    '≪': '<',
    '≫': '>',
    '∠': '<',
    'ß': 'β',
    'ꞵ': 'β',
    '∆': 'Δ',
    'Ι': 'I',
    'І': 'I',
    'Υ': 'Y', // topic 678270b4b100db787f87d7bb, question 678270b5b100db787f8a4746
    'υ': 'u', // topic 678270b4b100db787f87d7bb, question 678270b5b100db787f8a4746
    'Ɛ': 'Е', // topic 678270b4b100db787f87eff9, question 678270b5b100db787f8b2be5
    'ɛ': 'e', // topic 678270b4b100db787f87eff9, question 678270b5b100db787f8b2be5
    'ƞ': 'n', // topic 678270b4b100db787f87eb2e
    'א': 'α', // topic 678f37e8b4ae7993ad837a95
    '∂': 'δ', // topic 678270b4b100db787f87ee2b
    '¥': 'Y', // topic 678270b4b100db787f87ef7b
    'ү': 'γ', // topic 678270b4b100db787f87d0f1
    '٨': '⁸', // topic 67937edbd22aec2076351734
    '∩': '&', // topic 678270b4b100db787f87d288
    '£': 'f',  // topic 678270b4b100db787f87ee83
    'Ʊ': 'U', // topic 678270b4b100db787f87e570, question 678270b5b100db787f89daee
    'ʊ': 'u', // topic 678270b4b100db787f87e570, question 678270b5b100db787f89daee
    'Ӏ': 'I', // topic 678270b4b100db787f87dd61, question 678270b5b100db787f8b2633
    'ӏ': 'i', // topic 678270b4b100db787f87dd61, question 678270b5b100db787f8b2633
    'ɣ': 'γ', // topic 678270b4b100db787f87cef5
    '◊': '×', // topic 678270b4b100db787f87e416
    'Ј': 'J', // topic 678270b4b100db787f87dbc3, question 678270b5b100db787f8aea5f
    'ј': 'j', // topic 678270b4b100db787f87dbc3, question 678270b5b100db787f8aea5f
    '': 'α', // topic 678ac335ce35d36b479c2113
    'ϭ': 'б', // topic 678ac335ce35d36b479c2113
    '∕': '/', // topic 678270b4b100db787f87d6e8
    // неопределённые символы (не отображаются корректно)
    '': '°',
    '': '>',
    '': 'γ',
    '': "'", // topic 678270b4b100db787f87e6f2
    '': 'β', // topic 678270b4b100db787f87d9ed
    '': 'Δ', // topic 678270b4b100db787f87d4a8
    '': '×', // topic 67a782682ab40dd958d7cc77
    '': '↑',
    '': '↓', // question 678270b4b100db787f8947a1, topics 678270b4b100db787f87ecbc, 678270b4b100db787f87edfb
    '': '+' // question 678270b5b100db787f8ae875, topic 678270b4b100db787f87e39b
}

// список разрешённых символов
const regexSymbols = /[^a-zA-Zа-яА-ЯёЁ0-9 .,!?'"\/\\+\-_×*%&@#;:(){}\[\]<>=|^~$№°⁰¹²³⁴⁵⁶⁷⁸⁹®₽λαβΔγμδσΩωτεπνφιΣθ→↑↓←≈∞√†]/gu // /u для .test а /gu для .replace

const regexWords = /\b(?=[a-zA-Z]*[а-яА-ЯёЁ])(?=[а-яА-ЯёЁ]*[a-zA-Z])\w+\b/
const regexWord = /(?=.*\p{Script=Latin})(?=.*\p{Script=Cyrillic})/u

const latinToCyrillicMap = {
    A: 'А', a: 'а',
    B: 'В',
    E: 'Е', e: 'е',
    K: 'К',
    M: 'М', m: 'м',
    H: 'Н',
    O: 'О', o: 'о',
    P: 'Р', p: 'р',
    C: 'С', c: 'с',
    T: 'Т',
    Y: 'У', y: 'у',
    X: 'Х', x: 'х'
}
const cyrillicToLatinMap = Object.fromEntries(Object.entries(latinToCyrillicMap).map(([k, v]) => [v, k]))

function normalizeText(str, topic) {
    let text = str
        .replace(/[^йЙёЁ№º⁰¹²³⁴⁵⁶⁷⁸⁹″]+/g, segment => segment.normalize('NFKD')) // разбиваем на базовые буквы + диакритики, но при этом не трогаем символы разрешённые для использования с диакритиками
        .replace(/[\u0300-\u036F]/g, '')  // удалить все диакритики
        .normalize('NFC') // Приводит строку к нормализованной форме составленных символов (Canonical Composition). Это значит, что символы, состоящие из нескольких кодов (например, буква + диакритика), будут объединены в один составной символ, если это возможно.
        .replace(/[\u00A0\u2000-\u200D\u202F\u205F\u3000]/g, ' ') // Заменить все "нестандартные" пробелы на обычный
        .replace(/[‐‑‒–—―−─]/g, '-') // Заменить все тире на обычный дефис
        .replace(/[«»„“”″]/g, '"').replace(/[‘’‚‹›′`ʹ]/g, "'") // нестандартные кавычки
        .replace(/\p{Cf}/gu, '') // невидимые символы
        .replace(/\s+/g, ' ') // Сжатие пробелов (двойные пробелы)
        .trim() // Убрать пробелы по краям
    text = text.replaceAll('<sup>', '').trim()
    text = text.replaceAll('</sup>', '').trim()
    if (topic) text = removeTestLabels(text).trim()

    const forbiddenChars = text.match(regexSymbols)
    if (forbiddenChars?.length) {
        // console.warn('Обнаружены запрещённые символы в тексте! ' + forbiddenChars)
        text = text.split('').map(char => LATIN_TO_VIEW_CYRILLIC_NEW[char] || char).join('')
        const newForbiddenChars = text.match(regexSymbols)
        if (newForbiddenChars?.length) {
            /*throw Error*/console.warn('Не удалось избавится от нестандартных символов ' + newForbiddenChars)
        }
    }

    let failedSuspiciousWords
    text = text.replace(/[а-яёa-z]+/gi, word => {
        if (!regexWord.test(word)) return word
        let newWord = word.split('').map(char => latinToCyrillicMap[char] || char).join('')
        if (regexWord.test(newWord)) {
            newWord = word.split('').map(char => cyrillicToLatinMap[char] || char).join('')
        }
        if (regexWord.test(newWord)) {
            failedSuspiciousWords = true
            /*throw Error*/console.warn('Не удалось избавиться от смешанных букв в слове ' + word)
            return word
        }
        return newWord
    })
    if (!failedSuspiciousWords && (regexWords.test(text) || (text.match(regexWords)?.length))) {
        /*throw Error*/console.warn('Обнаружены подозрительные слова в тексте!')
    }

    if (topic && text.toLowerCase().startsWith('вариант №')) {
        return null
    }

    return text
}

function removeTestLabels(str) {
    return str.replace(/\s*-\s*(итоговое|предварительное|входное|контрольное|базовое)?\s*тестирование\s*$/i, '')
}

// noinspection JSUnresolvedReference
if (typeof global !== 'undefined') {
    // noinspection JSUnresolvedReference
    global.normalizeText = normalizeText
} else {
    self.normalizeText = normalizeText
}