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
}