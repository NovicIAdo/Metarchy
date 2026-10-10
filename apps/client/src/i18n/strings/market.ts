import type { Strings } from '../types.js'

/**
 * The player↔player market: the shelf, the lot cards, the haggle underneath.
 * Distinct from `shop.*`, which sells the catalog at a fixed price — the words
 * have to keep the two apart, because a player who confuses them will wonder why
 * the same skin costs two different amounts.
 */
export const market: Strings = {
  'market.title': { en: 'Market', ru: 'Рынок' },
  'market.blurb': {
    en: 'What other players are selling, at the price they ask. Comment on a lot to haggle.',
    ru: 'Что продают другие игроки и по какой цене. Комментарий под лотом — это торг.'
  },
  'market.buy': { en: 'Buy', ru: 'Купить' },
  'market.cancelLot': { en: 'Withdraw', ru: 'Снять с продажи' },
  'market.mine': { en: 'My lots', ru: 'Мои лоты' },
  'market.yours': { en: 'Your lot', ru: 'Ваш лот' },
  'market.empty': { en: 'Nothing on the shelf yet.', ru: 'На полке пока пусто.' },
  'market.noneOfYours': { en: 'You have nothing up for sale.', ru: 'Вы ничего не выставили.' },
  'market.alreadyOwned': { en: 'You already own this', ru: 'У вас уже есть' },
  'market.count': { en: '{n} lots', ru: 'Лотов: {n}' },
  'market.toInventory': { en: 'My inventory', ru: 'Мой инвентарь' },

  'market.cat.all': { en: 'All', ru: 'Все' },
  'market.cat.actorSkin': { en: 'Actor skins', ru: 'Скины Деятелей' },
  'market.cat.argumentSkin': { en: 'Argument skins', ru: 'Скины Аргументов' },
  'market.cat.actorItem': { en: 'Actor items', ru: 'Предметы Деятелей' },
  'market.cat.avatar': { en: 'Avatars', ru: 'Аватарки' },

  'market.noComments': { en: 'No comments yet.', ru: 'Комментариев пока нет.' },
  'market.commentPlaceholder': {
    en: 'Drop the price and I will take it…',
    ru: 'Снизь цену, возьму этот предмет…'
  },
  'market.send': { en: 'Send', ru: 'Отправить' },
  'market.writeSeller': { en: 'Message seller', ru: 'Написать продавцу' }
}
