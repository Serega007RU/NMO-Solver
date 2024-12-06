{
    // подобным образом мы отключаем анимации и ускоряем процесс переключения на следующий вопрос
    Animation.prototype.addEventListener = new Proxy(Animation.prototype.addEventListener, {
        apply(target, self, args) {
            if (args && args?.[1] && self instanceof Animation && args?.[0] === 'finish') {
                setTimeout(() => {
                    args[1]()
                }, 1)
            } else {
                return Reflect.apply(target, self, args)
            }
        }
    })

    // window.addEventListener = new Proxy(window.addEventListener, {
    //     apply(target, self, args) {
    //         if (args && args?.[1] && args?.[0] === 'animationend') {
    //             setTimeout(() => {
    //                 args[1]()
    //             }, 1)
    //         } else {
    //             return Reflect.apply(target, self, args)
    //         }
    //     }
    // })

    /* requestAnimationFrame */
    let lastTime = 0
    window.requestAnimationFrame = new Proxy(window.requestAnimationFrame, {
        apply(target, self, args) {
            const currTime = Date.now()
            const timeToCall = Math.max(0, 16 - (currTime - lastTime))
            const id = setTimeout(function() {
                args[0](performance.now())
            }, timeToCall)
            lastTime = currTime + timeToCall
            return id
        }
    })
    window.cancelAnimationFrame = new Proxy(window.cancelAnimationFrame, {
        apply(target, self, args) {
            clearTimeout(args[0])
        }
    })
}