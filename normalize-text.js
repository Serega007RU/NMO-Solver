const LATIN_TO_VIEW_CYRILLIC = {
    // (//\s+\d+.{14}(.).*)
    // '$2': 'L', $1
    'A': 'А', //   913	U+0391	CE 91	Α	Greek Capital Letter Alpha
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
    'γ': 'у', //   947	U+03B3	CE B3	γ	Greek Small Letter Gamma
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
    'Ё': 'Е', //   1025	U+0401	D0 81	Ё	Cyrillic Capital Letter Io
    //
    'Ҋ': 'Й', //   1162	U+048A	D2 8A	Ҋ	Cyrillic Capital Letter Short I With Tail
    'ҋ': 'й', //   1163	U+048B	D2 8B	ҋ	Cyrillic Small Letter Short I With Tail

    a: 'а',
    'ͣ': 'а', // 867	U+0363	CD A3	ͣ	Combining Latin Small Letter A
    'Ƃ': 'Б', //386	U+0182	C6 82	Ƃ	Latin Capital Letter B With Topbar
    B: 'В',
    'ʙ': 'в', // 665	U+0299	CA 99	ʙ	Latin Letter Small Capital B
    E: 'Е',
    e: 'е',
    'ͤ': 'е', // 868	U+0364	CD A4	ͤ	Combining Latin Small Letter E
    'Ȅ': 'E', // 516	U+0204	C8 84	Ȅ	Latin Capital Letter E With Double Grave
    'ȅ': 'е', // 517	U+0205	C8 85	ȅ	Latin Small Letter E With Double Grave
    'Ʒ': 'З', // 439	U+01B7	C6 B7	Ʒ	Latin Capital Letter Ezh
    'Ͷ': 'И', // 886	U+0376	CD B6	Ͷ	Greek Capital Letter Pamphylian Digamma
    'ͷ': 'и', // 887	U+0377	CD B7	ͷ	Greek Small Letter Pamphylian Digamma
    K: 'К',
    k: 'к',
    'ĸ': 'к', // 312	U+0138	C4 B8	ĸ	Latin Small Letter Kra
    M: 'М',  // нет маленькой
    H: 'Н',  // нет маленькой
    'ʜ': 'Н',  // 668	U+029C	CA 9C	ʜ	Latin Letter Small Capital H
    O: 'О',
    o: 'о',
    'ȏ': 'о', // 527	U+020F	C8 8F	ȏ	Latin Small Letter O With Inverted Breve
    'ͦ': 'о', // 870	U+0366	CD A6	ͦ	Combining Latin Small Letter O
    P: 'Р',
    p: 'р',
    C: 'С',
    c: 'с',
    'ͨ': 'с', // 872	U+0368	CD A8	ͨ	Combining Latin Small Letter C
    T: 'Т', // нет маленькой
    // 882	U+0372	CD B2	Ͳ	Greek Capital Letter Archaic Sampi
    // 883	U+0373	CD B3	ͳ	Greek Small Letter Archaic Sampi
    'Ţ': 'Т', // 354	U+0162	C5 A2	Ţ	Latin Capital Letter T With Cedilla
    X: 'Х',
    x: 'х',
    'ͯ': 'х', // 879	U+036F	CD AF	ͯ	Combining Latin Small Letter X
    '«': '"',
    '»': '"',
    '–': '-',
}

function latinToViewCyrillic(input) {
    return input.split('')
        .map(char => LATIN_TO_VIEW_CYRILLIC[char] || char)
        .join('')
}

function normalizeText(str) {
    let text = latinToViewCyrillic(str).trim().toLowerCase()
    text = text.replaceAll('<suр>', '')
    text = text.replaceAll('</suр>', '')
    if (text.endsWith(' - итоговое тестирование')) text = text.replaceAll(' - итоговое тестирование', '')
    if (text.endsWith(' - предварительное тестирование')) text = text.replaceAll(' - предварительное тестирование', '')
    if (text.endsWith(' - входное тестирование')) text = text.replaceAll(' - входное тестирование', '')
    if (text.endsWith(' - тестирование')) text = text.replaceAll(' - тестирование', '')
    return text
}
self.normalizeText = normalizeText