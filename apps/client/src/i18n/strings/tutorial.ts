import type { Strings } from '../types.js'

// The coached, no-timer Tutorial (mode: 'tutorial'). `coach.*` drives the
// TutorialCoach overlay that sits on top of a real game vs a bot: an intro
// "window" per concept, then a pulsing spotlight + one-line hint every turn.
// RU follows the rulebook canon (Деятель / Аргумент / Ставка / Ход / Фаза).
export const tutorial: Strings = {
  // Entry points (Home button + the How-to-Play walkthrough's final CTA).
  'home.tutorial': { en: 'Tutorial', ru: 'Обучение' },
  'tutorial.start': { en: 'Start the Tutorial', ru: 'Начать обучение' },

  // Coach chrome
  'coach.dismiss': { en: 'Got it', ru: 'Понятно' },
  'coach.next': { en: 'Next →', ru: 'Дальше →' },
  // Walks a page back, then into the cards already shown — re-reading, so it
  // never says "Got it".
  'coach.prev': { en: '← Back', ru: '← Назад' },
  'coach.page': { en: 'Page {n}', ru: 'Страница {n}' },
  'coach.reopen': { en: 'Show the tip again', ru: 'Показать подсказку' },
  'coach.turnPhase': { en: 'Turn {n} · Phase {m}', ru: 'Ход {n} · Фаза {m}' },
  'coach.wait': { en: 'The bot is thinking…', ru: 'Бот думает…' },
  // Player feedback (14 y/o): every instruction also says WHY it matters.
  'coach.why': { en: 'Why', ru: 'Зачем' },

  // Turn-1 narrative intro (the paged card before the first placement)
  'coach.intro.welcome.title': {
    en: 'Welcome to Metarchy',
    ru: 'Добро пожаловать в Metarchy'
  },
  'coach.intro.welcome.body': {
    en: 'Over 5 turns you compete to build the most Victory Points. It all starts with your Actors — let’s learn to place them.',
    ru: 'За 5 ходов вы соревнуетесь за наибольшее число Победных баллов. Всё начинается с ваших Деятелей — давайте научимся их расставлять.'
  },
  'coach.intro.place.title': {
    en: 'Place your Actors',
    ru: 'Расставьте Деятелей'
  },
  'coach.intro.place.body': {
    en: 'Each turn, players secretly send their Actors to Locations — and every Actor carries a hidden Argument. Nothing is revealed until everyone has committed.',
    ru: 'Каждый ход игроки тайно отправляют своих Деятелей на Локации — и у каждого Деятеля есть скрытый Аргумент. Ничего не вскрывается, пока все не зафиксируют выбор.'
  },
  'coach.intro.conflict.title': {
    en: 'Same type? Conflict!',
    ru: 'Одинаковые? Конфликт!'
  },
  'coach.intro.conflict.body': {
    en: 'If two Actors of the same type — say two Politicians — meet on one Location, a Conflict breaks out, and one of them must leave the Location! Who stays and who goes is decided by their Arguments — Rock, Paper, Scissors.',
    ru: 'Если два Деятеля одного типа — например, два Политика — встретятся на одной Локации, между ними произойдёт Конфликт, и один будет вынужден покинуть Локацию! Кто останется, а кто уйдёт — решают их Аргументы: Камень, Ножницы, Бумага.'
  },

  // P1 — event
  'coach.p1.event.title': {
    en: 'Read the Event, then continue',
    ru: 'Прочтите Событие и продолжите'
  },
  'coach.p1.event.body': {
    en: 'Every turn opens with an Event that changes the board for everyone. Read what it does, then tap to continue.',
    ru: 'Каждый ход начинается с События, которое меняет поле для всех. Прочтите его эффект и нажмите, чтобы продолжить.'
  },
  'coach.p1.discard.title': {
    en: 'Choose how much to discard',
    ru: 'Выберите, сколько сбросить'
  },
  'coach.p1.discard.body': {
    en: 'Both players secretly choose how much to throw in — whoever discards MORE draws an Action Card. Discard at least 1 to compete; on a tie the players resolve the conflict themselves, just like Actors do.',
    ru: 'Оба игрока втайне решают, сколько сбросить — кто сбросил БОЛЬШЕ, тянет Карту действий. Сбросьте хотя бы 1, чтобы претендовать; при равенстве игроки сами разрешают конфликт — совсем как Деятели.'
  },
  'coach.p1.discard.why': {
    en: 'Resources are also what Bets cost — throwing in too much can leave you unable to bet.',
    ru: 'Ресурсы — это ещё и оплата Ставок: сбросите слишком много, и ставить будет нечем.'
  },
  'coach.p1.standoff.title': {
    en: 'A tie! Players resolve it themselves',
    ru: 'Ничья! Игроки разрешают её сами'
  },
  'coach.p1.standoff.body': {
    en: 'The comparison ended level. When players tie, THEY resolve the conflict — an open round of Rock, Paper, Scissors decides who takes the Fame.',
    ru: 'Сравнение закончилось поровну. Когда игроки равны, конфликт разрешают ОНИ сами — открытый раунд Камень-Ножницы-Бумага решает, кому достанется Слава.'
  },
  'coach.p1.tiebreak.title': {
    en: 'Throw Rock, Paper or Scissors',
    ru: 'Бросьте Камень, Ножницы или Бумагу'
  },
  'coach.p1.tiebreak.body': {
    en: 'This is the conflict resolution between players: everyone throws at once, the winning throw takes it. Pick your gesture.',
    ru: 'Это разрешение конфликта между игроками: все бросают одновременно, побеждает сильнейший жест. Выберите свой.'
  },
  'coach.p1.tiebreak.again.title': {
    en: 'Same throw — a draw! Another round',
    ru: 'Одинаковые жесты — ничья! Ещё раунд'
  },
  'coach.p1.tiebreak.again.body': {
    en: 'You both threw the same — that is a draw, and a draw always leads to a NEW round of resolution. Throw again until someone wins.',
    ru: 'Вы бросили одно и то же — это ничья, а ничья всегда ведёт к НОВОМУ раунду разрешения. Бросайте снова, пока кто-то не победит.'
  },

  // P2 — distribution (the core coached loop)
  'coach.p2.pick.title': {
    en: 'Choose an Actor and send it to a Location',
    ru: 'Выберите Деятеля и отправьте его на Локацию'
  },
  'coach.p2.pick.body': {
    en: 'Follow the arrow: tap one of your Actors on the left to pick it up, and the Locations it may enter light up. It works the other way round too — tap a Location and choose who goes there.',
    ru: 'Идите за стрелкой: нажмите на одного из своих Деятелей слева, чтобы взять его, — и Локации, куда ему можно, подсветятся. Работает и наоборот: нажмите на Локацию и выберите, кто туда пойдёт.'
  },
  'coach.p2.pick.why': {
    en: 'Each Actor makes a different Value, and only in its own Locations.',
    ru: 'Каждый Деятель создаёт свою Ценность — и только на своих Локациях.'
  },
  'coach.p2.place.title': {
    en: 'Now drag or tap where the arrows point',
    ru: 'Теперь тащите или нажмите туда, куда показывают стрелки'
  },
  'coach.p2.place.why': {
    en: 'Only these Locations accept this Actor — the arrows show every one of them.',
    ru: 'Этого Деятеля принимают только эти Локации — стрелки показывают все.'
  },
  'coach.p2.chooseActor.title': {
    en: 'Choose who goes here',
    ru: 'Выберите, кто сюда пойдёт'
  },
  'coach.p2.chooseActor.body': {
    en: 'You tapped a Location, so it asks who should go there — and it offers only the Actors this Location accepts and you have not placed yet. Tap one and carry on as usual.',
    ru: 'Вы нажали на Локацию — и она спрашивает, кого туда отправить, предлагая только тех Деятелей, кого эта Локация принимает и кто ещё не расставлен. Нажмите на любого и продолжайте как обычно.'
  },
  'coach.p2.chooseActor.why': {
    en: 'Two ways to place, same result: pick up an Actor, or pick a Location first.',
    ru: 'Два способа расставить, результат один: взять Деятеля — или сначала выбрать Локацию.'
  },
  'coach.p2.arg.title': {
    en: 'Choose a hidden Argument — then Bet or Skip',
    ru: 'Выберите скрытый Аргумент — затем Ставка или Пропуск'
  },
  'coach.p2.arg.body': {
    en: 'Pick a hidden Argument for this Actor (no two of yours may match). You may then spend a Resource to Bet on the clash, or Skip.',
    ru: 'Выберите скрытый Аргумент для этого Деятеля (одинаковых у вас быть не может). Затем можно потратить Ресурс на Ставку об исходе — или Пропустить.'
  },
  'coach.p2.arg.why': {
    en: 'If a rival sends the same Actor type here, this Argument is what decides who stays.',
    ru: 'Если соперник пришлёт сюда такого же Деятеля, именно этот Аргумент решит, кто останется.'
  },
  'coach.p2.more.title': { en: 'Place your other Actors', ru: 'Расставьте остальных Деятелей' },
  'coach.p2.more.why': {
    en: 'All four must be placed — an Actor left at home earns nothing.',
    ru: 'Расставить нужно всех четверых — Деятель, оставшийся дома, ничего не приносит.'
  },
  'coach.p2.commit.title': {
    en: 'Seal your turn — tap Commit',
    ru: 'Зафиксируйте ход — нажмите Подтвердить'
  },
  'coach.p2.commit.why': {
    en: 'Nobody sees your placement until everyone has sealed — and you do not see theirs.',
    ru: 'Пока все не зафиксируют, вашу расстановку не видит никто — и вы не видите чужую.'
  },
  'coach.p2.revealed.title': {
    en: 'Now look at the table',
    ru: 'Теперь посмотрите на стол'
  },
  'coach.p2.revealed.body': {
    en: 'Everyone has placed, and the board is open: you can see where your opponent sent each Actor. Their Arguments and Bets stay hidden until the Conflicts. Two Actors of the SAME type in one Location means a Conflict there.',
    ru: 'Все расставили, и стол открыт: видно, куда соперник отправил каждого Деятеля. Его Аргументы и Ставки останутся скрыты до Конфликтов. Два Деятеля ОДНОГО типа в одной Локации — там будет Конфликт.'
  },
  'coach.p2.sealed.title': {
    en: 'Sealed. The bot is choosing in secret…',
    ru: 'Зафиксировано. Бот выбирает втайне…'
  },

  // P3 — action cards
  'coach.p3.select.title': {
    en: 'Play an Action Card, or play none',
    ru: 'Разыграйте Карту действий или ни одной'
  },
  'coach.p3.select.body': {
    en: 'Action Cards bend the rules — move an Actor, block a Location, swap Values. Choose any to play this turn, or play none.',
    ru: 'Карты действий гнут правила — переместить Деятеля, закрыть Локацию, обменять Ценности. Выберите любые на этот ход или ни одной.'
  },
  'coach.p3.select.why': {
    en: 'Cards resolve BEFORE the Conflicts — this is the last moment to change the board.',
    ru: 'Карты срабатывают ДО Конфликтов — это последний момент изменить расклад на столе.'
  },
  'coach.p3.sealed.title': {
    en: 'Cards locked in. Waiting for the bot…',
    ru: 'Карты зафиксированы. Ждём бота…'
  },
  'coach.p3.relocate.title': {
    en: 'Move an Actor: tap one, then its new Location',
    ru: 'Переместите Деятеля: нажмите на него, затем на новую Локацию'
  },
  'coach.p3.relocate.body': {
    en: "Your card relocates an Actor — yours or the bot's. Tap an Actor on the board, then a glowing Location, then Done.",
    ru: 'Ваша карта перемещает Деятеля — своего или бота. Нажмите на Деятеля на доске, затем на подсвеченную Локацию, затем Готово.'
  },
  'coach.p3.results.title': {
    en: 'See what the cards did, then continue',
    ru: 'Посмотрите, что сделали карты, и продолжите'
  },
  'coach.p3.opponent.title': {
    en: 'Opponents play cards too!',
    ru: 'Соперники тоже играют карты!'
  },
  'coach.p3.opponent.body': {
    en: 'The bot just played an Action Card — look what it did to the board. In real matches, expect rivals to bend the rules the same way: block a Location, move your Actors, trade away your Values.',
    ru: 'Бот только что разыграл Карту действий — посмотрите, что она сделала с полем. В настоящих матчах ждите того же от соперников: закрыть Локацию, передвинуть ваших Деятелей, обменять ваши Ценности.'
  },

  // P4 — conflict
  'coach.p4.conflict.title': {
    en: 'Conflict! Reveal the Arguments',
    ru: 'Конфликт! Вскройте Аргументы'
  },
  'coach.p4.conflict.body': {
    en: 'Here it is — the Conflict we warned about! The two Actors reveal their hidden Arguments: Rock beats Scissors, Scissors beats Paper, Paper beats Rock. The loser leaves the Location with nothing — and only an Actor that STAYS produces: a Value, or Resources in the case of Robots.',
    ru: 'Вот и он — тот самый Конфликт, о котором мы предупреждали! Оба Деятеля вскрывают скрытые Аргументы: Камень бьёт Ножницы, Ножницы бьют Бумагу, Бумага бьёт Камень. Проигравший покидает Локацию ни с чем — а производит только тот Деятель, который ОСТАЛСЯ: Ценность, а в случае Роботов — Ресурсы.'
  },
  'coach.p4.watch.title': {
    en: 'A conflict is resolving — watch',
    ru: 'Идёт разрешение конфликта — смотрите'
  },
  'coach.p4.result.title': {
    en: 'See the outcome, then continue',
    ru: 'Посмотрите исход и продолжите'
  },
  // Outcome lessons: from turn 2 the bot argues at random, so a Conflict can end
  // any way at all — every ending explains itself the first time it happens.
  'coach.p4.result.win.title': {
    en: 'You won the Conflict!',
    ru: 'Вы выиграли Конфликт!'
  },
  'coach.p4.result.win.body': {
    en: 'Your Argument was the stronger one. The rival Actor leaves the Location empty-handed, and yours stays — and an Actor that stays produces: a Value for people, Resources for a Robot.',
    ru: 'Ваш Аргумент оказался сильнее. Деятель соперника покидает Локацию ни с чем, а ваш остаётся — а тот, кто остался, производит: люди — Ценность, Робот — Ресурсы.'
  },
  'coach.p4.result.lose.title': {
    en: 'This one is lost',
    ru: 'Этот Конфликт проигран'
  },
  'coach.p4.result.lose.body': {
    en: 'The rival Argument was stronger, so your Actor leaves the Location and brings nothing home — the one that stayed is the one that produces. Nothing is lost for good: every Actor returns to you for the next turn.',
    ru: 'Аргумент соперника оказался сильнее, поэтому ваш Деятель покидает Локацию и возвращается ни с чем — производит тот, кто остался. Ничего не потеряно навсегда: все Деятели вернутся к вам на следующий ход.'
  },
  'coach.p4.draw.politician.title': {
    en: 'Politicians drew — they resolve it again!',
    ru: 'Ничья Политиков — разрешаем заново!'
  },
  'coach.p4.draw.politician.body': {
    en: 'The Arguments matched — a draw. Politicians never accept a draw: nobody leaves and nobody produces yet — the Conflict is resolved AGAIN, until one of them wins. In a moment each side picks a fresh Argument.',
    ru: 'Аргументы совпали — ничья. Политики не терпят ничьих: никто не уходит и никто пока ничего не производит — Конфликт разрешается ЗАНОВО, пока кто-то не победит. Сейчас каждая сторона выберет новый Аргумент.'
  },
  'coach.p4.refight.title': {
    en: 'Not settled — resolving again',
    ru: 'Не решилось — разрешаем заново'
  },
  'coach.p4.refight.body': {
    en: 'This Conflict has not produced a clear winner yet, so it is resolved again — a fresh round of Arguments between the Actors still standing, this time without Bets.',
    ru: 'Конфликт пока не выявил победителя, поэтому разрешается заново — новый раунд Аргументов между оставшимися Деятелями, уже без Ставок.'
  },
  'coach.p4.rps.title': {
    en: 'Pick a fresh Argument and resolve again',
    ru: 'Выберите новый Аргумент — разрешаем заново'
  },
  'coach.p4.rps.body': {
    en: 'Both sides secretly throw again — Rock, Paper or Scissors. The winner stays on the Location and takes the Value.',
    ru: 'Обе стороны снова втайне бросают — Камень, Ножницы или Бумагу. Победитель остаётся на Локации и забирает Ценность.'
  },
  'coach.p4.rps.again.title': {
    en: 'Matched again — a draw! One more round',
    ru: 'Снова совпало — ничья! Ещё раунд'
  },
  'coach.p4.rps.again.body': {
    en: 'The throws matched — that is a draw, and every draw leads to a NEW round. Keep throwing until someone wins.',
    ru: 'Броски совпали — это ничья, а каждая ничья ведёт к НОВОМУ раунду. Бросайте, пока кто-то не победит.'
  },
  // The draw rules all follow from one thing: an Actor produces only if it STAYS
  // in the Location. Scientists and Robots both stay, so both produce; Artists
  // both leave, so nothing is created there at all.
  'coach.p4.draw.scientist.title': {
    en: 'Scientists drew — both stay, both produce',
    ru: 'Ничья Учёных — оба остаются, оба производят'
  },
  'coach.p4.draw.scientist.body': {
    en: 'Scientists share their discoveries, so a draw sends nobody away: BOTH Scientists stay on the Location — and an Actor that stays produces. Both create Knowledge, +1 each.',
    ru: 'Учёные делятся открытиями, поэтому при ничьей никто не уходит: ОБА Учёных остаются на Локации — а тот, кто остался, производит. Оба создают Знание, по +1.'
  },
  'coach.p4.draw.artist.title': {
    en: 'Artists drew — both leave, no Art',
    ru: 'Ничья Артистов — оба уходят, Искусства нет'
  },
  'coach.p4.draw.artist.body': {
    en: 'Art is only recognised when one Artist is visibly better than the other. On a draw BOTH Artists leave the Location — and an Actor that leaves produces nothing, so no Art is created here this turn.',
    ru: 'Искусство признают, только когда один Артист заметно лучше другого. При ничьей ОБА Артиста покидают Локацию — а ушедший Деятель ничего не производит, значит Искусство здесь в этот ход не создаётся.'
  },
  'coach.p4.draw.robot.title': {
    en: 'Robots drew — both stay and mine',
    ru: 'Ничья Роботов — оба остаются и добывают'
  },
  'coach.p4.draw.robot.body': {
    en: 'Robots do not argue, they work. On a draw both Robots stay on the Location, so both produce: +1 Resource of this Location each for its owner (a win would have brought 3).',
    ru: 'Роботы не спорят, они работают. При ничьей оба Робота остаются на Локации, а значит оба производят: по +1 Ресурсу этой Локации своему владельцу (победа принесла бы 3).'
  },
  'coach.p4.bet.draw.title': {
    en: 'Your Draw bet came true!',
    ru: 'Ваша Ставка на Ничью сыграла!'
  },
  'coach.p4.bet.draw.body': {
    en: 'You bet on a Draw — and the Arguments matched. A successful Draw bet turns YOUR draw into a WIN: your Actor stays and takes the full reward, while the other side of the draw leaves with nothing. A strong play when you expect equal Arguments.',
    ru: 'Вы поставили на Ничью — и Аргументы совпали. Успешная Ставка на Ничью превращает ВАШУ ничью в ПОБЕДУ: ваш Деятель остаётся и забирает полную награду, а вторая сторона ничьей остаётся ни с чем. Сильный ход, если ждёте равных Аргументов.'
  },
  'coach.p4.bet.win.title': {
    en: 'Your Win bet paid off!',
    ru: 'Ваша Ставка на Победу сыграла!'
  },
  'coach.p4.bet.win.body': {
    en: 'You spent a Resource betting this Actor would win — and it did. A successful Win bet adds +1 to what it produces: one extra Value, or one extra Resource for a Robot.',
    ru: 'Вы потратили Ресурс на Ставку, что этот Деятель победит — так и вышло. Успешная Ставка на Победу добавляет +1 к тому, что он производит: одну Ценность сверху, а Роботу — один Ресурс сверху.'
  },
  'coach.p4.bet.lose.title': {
    en: 'Your Lose bet paid off — a rematch!',
    ru: 'Ваша Ставка на Поражение сыграла — переигровка!'
  },
  'coach.p4.bet.lose.body': {
    en: 'You bet this Actor would lose — and it did. A successful Lose bet cancels the rewards of that round and the Conflict is resolved AGAIN, now without Bets: your Actor gets a second chance to stay on the Location.',
    ru: 'Вы поставили на то, что этот Деятель проиграет — так и вышло. Успешная Ставка на Поражение отменяет награды того раунда, и Конфликт разрешается ЗАНОВО, уже без Ставок: у вашего Деятеля появляется второй шанс остаться на Локации.'
  },
  'coach.p4.summary.title': {
    en: 'What this turn produced',
    ru: 'Что произвёл этот ход'
  },
  'coach.p4.summary.body': {
    en: 'The turn’s results, Location by Location: who stayed, who left, and what each Location produced. Values — Power, Art and Knowledge — form Victory Points; Resources pay for Bets and Cards.',
    ru: 'Итоги хода по Локациям: кто остался, кто ушёл и что произвела каждая Локация. Ценности — Власть, Искусство и Знание — складываются в Победные баллы, а Ресурсы платят за Ставки и Карты.'
  },

  // P5 — market
  'coach.p5.market.title': {
    en: 'Trade Resources, buy Cards, then Done',
    ru: 'Обменяйте Ресурсы, купите Карты, затем Готово'
  },
  // The only place Action Cards are introduced: turn 1 has no Phase 3 at all
  // (rulebook §Turn Structure), so the player meets the cards here first.
  'coach.p5.market.body': {
    en: 'The Market — this is where Action Cards come from. Spend Resources on cards that bend the rules on future turns, then tap Done. They arrive in your hand next turn.',
    ru: 'Рынок — именно здесь берутся Карты действий. Потратьте Ресурсы на карты, которые гнут правила в будущих ходах, и нажмите Готово. Они придут в руку на следующем ходу.'
  },
  'coach.p5.market.why': {
    en: 'Resources spent here are Resources you cannot Bet with next turn — that is the trade.',
    ru: 'Потраченные тут Ресурсы — это Ресурсы, которыми не поставишь на следующем ходу. Вот и весь размен.'
  },
  'coach.p5.sealed.title': {
    en: 'Market closed. Waiting for the bot…',
    ru: 'Рынок закрыт. Ждём бота…'
  },

  // Game over (shown on the finished screen when mode is tutorial)
  'coach.finished.title': { en: 'Tutorial complete! 🎓', ru: 'Обучение пройдено! 🎓' },
  'coach.finished.body': {
    en: "You're doing great! You've got the basics — and Metarchy still hides plenty of interesting nuances and deep strategies to discover. What you've learned is already enough to play your first real game against a bot.",
    ru: 'У вас всё здорово получается! Основы освоены — а в Метархии ещё много интересных нюансов и глубоких стратегий. Полученных знаний уже достаточно, чтобы сыграть первую игру с ботом.'
  },
  'coach.finished.cta': {
    en: 'Play your first game vs Bot',
    ru: 'Сыграть первую игру с ботом'
  }
}
