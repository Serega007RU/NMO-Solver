document.addEventListener('DOMContentLoaded', ()=> {
    //Загрузка переключателей
    let nav_btns = document.querySelectorAll('nav button')
    let blocks = document.querySelectorAll('div.block')
    nav_btns.forEach((el)=> {
        el.addEventListener('click', ()=> {
            blocks.forEach((block)=> {
                block.classList.remove('active')
                if (block.getAttribute('data-block') === el.getAttribute('data-block')) {
                    block.classList.add('active')
                }
            })

            nav_btns.forEach((btn)=> {
                btn.classList.remove('active')
            })
            el.classList.add('active')
        })
    })
})