import { openDB } from '/libs/idb.js';

const db = await openDB('nmo', 5)
const questions = await db.getAll('questions')
const topics = await db.getAll('topics')
const text = JSON.stringify({questions, topics})
const blob = new Blob([text],{type: 'text/json;charset=UTF-8;'})
const anchor = document.createElement('a')

anchor.download = 'nmo_db.json'
anchor.href = (window.webkitURL || window.URL).createObjectURL(blob)
anchor.dataset.downloadurl = ['text/json;charset=UTF-8;', anchor.download, anchor.href].join(':')
anchor.click()

self.close()