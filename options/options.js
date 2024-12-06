import { openDB } from '/libs/idb.js';

let db = await openDB('nmo', 1)
let questions = await db.getAll('questions')
const text = JSON.stringify(questions)
const blob = new Blob([text],{type: 'text/json;charset=UTF-8;'})
const anchor = document.createElement('a')

anchor.download = 'questions.json'
anchor.href = (window.webkitURL || window.URL).createObjectURL(blob)
anchor.dataset.downloadurl = ['text/json;charset=UTF-8;', anchor.download, anchor.href].join(':')
anchor.click()

self.close()