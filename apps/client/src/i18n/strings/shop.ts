import type { Strings } from '../types.js'

/** The Shop: GATO catalog shelves, entitlement badges, buy buttons. */
export const shop: Strings = {
  'shop.title': { en: 'Shop', ru: 'Магазин' },
  'shop.intro': {
    en: 'Avatars, actor skins and argument coins sell for GATO — the in-game token. Everything the game needs to be played you already own; the shelves are cosmetics on top. Owned items convert to NFTs once a wallet is linked (Account → Wallet).',
    ru: 'Аватары, скины Деятелей и монеты Аргументов продаются за GATO — внутриигровую монету. Всё, что нужно для самой игры, у вас уже есть; на полках — косметика сверху. Купленные предметы станут NFT после привязки кошелька (Аккаунт → Кошелёк).'
  },
  'shop.balance': { en: '{n} GATO', ru: '{n} GATO' },
  'shop.buy': { en: 'Buy', ru: 'Купить' },
  'shop.notEnough': { en: 'Not enough GATO', ru: 'Недостаточно GATO' },

  // Shelves
  'shop.shelf.avatars.title': { en: 'Avatars', ru: 'Аватары' },
  'shop.shelf.avatars.blurb': {
    en: 'Your face in lobbies, rosters and leaderboards.',
    ru: 'Ваше лицо в лобби, составах и таблицах лидеров.'
  },
  'shop.shelf.actorSkins.title': { en: 'Actor skins', ru: 'Скины Деятелей' },
  'shop.shelf.actorSkins.blurb': {
    en: 'Alternate looks for your Politician, Scientist, Artist and Robot.',
    ru: 'Альтернативный вид для Политика, Учёного, Артиста и Робота.'
  },
  'shop.shelf.argumentSkins.title': { en: 'Argument coins', ru: 'Монеты Аргументов' },
  'shop.shelf.argumentSkins.blurb': {
    en: 'The classic coins for Rock, Paper, Scissors and the Dummy are yours from the start. Each alloy below re-skins all four at once.',
    ru: 'Классические монеты Камня, Бумаги, Ножниц и Пустышки — ваши с самого начала. Каждый сплав ниже меняет вид сразу всех четырёх.'
  },
  'shop.shelf.currency.title': { en: 'Currency', ru: 'Валюта' },
  'shop.shelf.currency.blurb': {
    en: 'In-game currency packs for skins and cosmetics.',
    ru: 'Наборы игровой валюты для скинов и косметики.'
  },
  'shop.shelf.music.title': { en: 'Music', ru: 'Музыка' },
  'shop.shelf.music.blurb': {
    en: 'Alternate soundtracks for the table.',
    ru: 'Альтернативные саундтреки для стола.'
  },
  'shop.shelf.board.title': { en: 'Board themes', ru: 'Темы стола' },
  'shop.shelf.board.blurb': { en: 'New looks for the world map.', ru: 'Новый вид карты мира.' },
  'shop.shelf.cards.title': { en: 'Card art', ru: 'Оформление карт' },
  'shop.shelf.cards.blurb': {
    en: 'Alternate art sets for Action Cards.',
    ru: 'Альтернативные наборы оформления Карт действий.'
  },

  // Item names (non-domain)
  'shop.item.golden': { en: 'Golden', ru: 'Золотой' },
  'shop.item.viper': { en: 'Viper', ru: 'Гадюка' },
  'shop.item.ghost': { en: 'Ghost', ru: 'Призрак' },
  'shop.item.newFaces': { en: 'New faces', ru: 'Новые лица' },
  'shop.item.currencySoon': { en: 'Coming with payments', ru: 'Появится с платежами' },
  'shop.item.musicSoon': {
    en: 'Coming with the audio system',
    ru: 'Появится со звуковой системой'
  },
  'shop.argSet.default': { en: 'Classic gold', ru: 'Классическое золото' },
  'shop.argSet.silver': { en: 'Silver', ru: 'Серебро' },
  'shop.argSet.bronze': { en: 'Bronze', ru: 'Бронза' },
  'shop.argSet.matrix': { en: 'Matrix', ru: 'Матрица' },
  'shop.item.cyberpunk': { en: 'Cyberpunk', ru: 'Киберпанк' },
  'shop.item.synthwave': { en: 'Synthwave', ru: 'Синтвейв' },

  // Entitlement / buy states
  'shop.owned': { en: 'Owned', ru: 'В наличии' },
  'shop.soon': { en: 'Soon', ru: 'Скоро' },
  'shop.paymentsSoon': { en: 'Payments coming soon', ru: 'Платежи скоро' }
}
