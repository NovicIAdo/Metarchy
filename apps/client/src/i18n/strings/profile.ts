import type { Strings } from '../types.js'

/** The account cabinet: profile, actor skins/wardrobe, security, wallet, history. */
export const profile: Strings = {
  // Panel headings
  'profile.title': { en: 'Profile', ru: 'Профиль' },
  'profile.actorSkins': { en: 'Actor skins', ru: 'Скины Деятелей' },
  'profile.security': { en: 'Security', ru: 'Безопасность' },
  'profile.wallet': { en: 'Wallet', ru: 'Кошелёк' },
  'profile.solanaLogin': { en: 'Solana wallet login', ru: 'Вход с Solana-кошельком' },
  'profile.solanaBlurb': {
    en: 'Link a wallet to sign in to this player profile. Your progress and GATO stay with this account. Linking asks you to sign a message.',
    ru: 'Привяжите кошелёк для входа в этот профиль. Прогресс и GATO сохранятся в этом аккаунте. Для привязки нужно подписать сообщение.'
  },
  'profile.linkSolana': { en: 'Link a Solana wallet', ru: 'Привязать Solana-кошелёк' },
  'profile.walletLinked': {
    en: 'Wallet linked to this player profile.',
    ru: 'Кошелёк привязан к этому профилю.'
  },
  'profile.walletLoginEnabled': { en: 'Available for sign-in', ru: 'Доступен для входа' },
  'profile.walletMfaNeeded': {
    en: 'Set up two-factor authentication for this wallet before using it to sign in.',
    ru: 'Настройте двухфакторную аутентификацию для этого кошелька, чтобы использовать его для входа.'
  },
  'profile.walletMfa': {
    en: 'This account uses two-factor authentication. Verify an authenticator code for this login method, or set up its authenticator first.',
    ru: 'Для этого аккаунта включена двухфакторная аутентификация. Подтвердите код для этого способа входа или сначала настройте для него аутентификатор.'
  },
  'profile.mfaCode': { en: 'Authenticator code', ru: 'Код аутентификатора' },
  'profile.mfaCheckFailed': {
    en: 'Could not check account authentication. Check your connection and try again.',
    ru: 'Не удалось проверить аутентификацию аккаунта. Проверьте соединение и повторите попытку.'
  },
  'profile.retry': { en: 'Try again', ru: 'Повторить' },
  'profile.cancelLink': { en: 'Cancel linking', ru: 'Отменить привязку' },
  'profile.walletWaiting': {
    en: 'Waiting for wallet approval…',
    ru: 'Ожидание подтверждения кошелька…'
  },
  'profile.addEmail': { en: 'Add email login', ru: 'Добавить вход по почте' },
  'profile.addEmailBlurb': {
    en: 'Add an email and password to this player account. Confirm the email before using it to sign in.',
    ru: 'Добавьте почту и пароль к этому аккаунту. Подтвердите почту, прежде чем использовать её для входа.'
  },
  'profile.emailConfirmation': {
    en: 'Check your inbox to confirm your email.',
    ru: 'Проверьте почту и подтвердите адрес.'
  },
  'profile.recentGames': { en: 'Recent games', ru: 'Недавние игры' },
  'profile.record': { en: 'Games and win rate', ru: 'Игры и винрейт' },

  // Profile panel
  'profile.nickname': { en: 'Nickname', ru: 'Никнейм' },
  'profile.nicknameRule': {
    en: 'One word, {min}–{max} characters. Letters, digits, - _ ( ) [ ] < > — no spaces, nothing else. Every name is unique.',
    ru: 'Одно слово, {min}–{max} символов. Латинские буквы, цифры, - _ ( ) [ ] < > — без пробелов, других символов нельзя. Каждое имя уникально.'
  },
  // Refusals: keys match NicknameIssue in @metarchy/protocol, so the same
  // message reads the same whether the shared validator or the server said it.
  'profile.nickname.length': {
    en: 'Use between {min} and {max} characters.',
    ru: 'Используйте от {min} до {max} символов.'
  },
  'profile.nickname.charset': {
    en: 'One word only: letters, digits, - _ ( ) [ ] < >.',
    ru: 'Только одно слово: латинские буквы, цифры, - _ ( ) [ ] < >.'
  },
  'profile.nickname.reserved': { en: 'That name is reserved.', ru: 'Это имя зарезервировано.' },
  'profile.nickname.banned': { en: 'Pick a different name.', ru: 'Выберите другое имя.' },
  'profile.nickname.taken': {
    en: 'That name is already taken.',
    ru: 'Это имя уже занято.'
  },
  'profile.saved': { en: 'Saved.', ru: 'Сохранено.' },
  'profile.reconnectRename': {
    en: 'Reconnecting — renaming needs the server.',
    ru: 'Переподключение — для смены имени нужен сервер.'
  },
  'profile.avatar': { en: 'Avatar', ru: 'Аватар' },
  'profile.none': { en: 'None', ru: 'Нет' },
  'profile.noAvatar': { en: 'No avatar', ru: 'Без аватара' },
  'profile.avatarLabel': { en: 'Avatar {id}', ru: 'Аватар {id}' },

  // Record table (per-category games / wins / losses / win rate)
  'profile.record.category': { en: 'Category', ru: 'Категория' },
  'profile.record.played': { en: 'Games', ru: 'Игры' },
  'profile.record.wins': { en: 'Won', ru: 'Побед' },
  'profile.record.losses': { en: 'Lost', ru: 'Поражений' },
  'profile.record.rate': { en: 'Win rate', ru: 'Винрейт' },
  'profile.record.ranked': { en: 'Ranked', ru: 'Рейтинговые' },
  'profile.record.team': { en: '2v2 (unrated)', ru: '2×2 (без рейтинга)' },
  'profile.record.private': { en: 'Private', ru: 'Приватные' },
  'profile.record.bots': { en: 'vs Bots', ru: 'Против ботов' },
  'profile.record.blurb': {
    en: 'Counted over every finished game, not just the recent ones below. A forfeit or a lost connection counts as a loss; Tutorial games count nowhere.',
    ru: 'Считается по всем завершённым играм, а не только по недавним ниже. Сдача или потеря связи считается поражением; обучающие игры не учитываются.'
  },

  // Recent games
  'profile.noGames': { en: 'No finished games yet.', ru: 'Пока нет завершённых игр.' },
  'profile.verdictWin': { en: 'W', ru: 'В' },
  'profile.verdictLoss': { en: 'L', ru: 'П' },
  'profile.vp': { en: 'VP', ru: 'ПБ' },

  // Password
  'profile.changePassword': { en: 'Change password', ru: 'Смена пароля' },
  'profile.currentPassword': { en: 'Current password', ru: 'Текущий пароль' },
  'profile.passwordWrong': {
    en: 'Current password is wrong.',
    ru: 'Текущий пароль неверен.'
  },
  'profile.newPassword': { en: 'New password', ru: 'Новый пароль' },
  'profile.repeatPassword': { en: 'Repeat it', ru: 'Повторите' },
  'profile.updatePassword': { en: 'Update password', ru: 'Обновить пароль' },
  'profile.passwordsDiffer': { en: 'Passwords differ.', ru: 'Пароли не совпадают.' },
  'profile.passwordUpdated': { en: 'Password updated.', ru: 'Пароль обновлён.' },

  // Two-factor / passkeys
  'profile.twoFactor': { en: 'Two-factor authentication', ru: 'Двухфакторная аутентификация' },
  'profile.addAuthenticator': {
    en: 'Add an authenticator app — a 6-digit code will be asked at sign-in.',
    ru: 'Добавьте приложение-аутентификатор — при входе будет запрашиваться 6-значный код.'
  },
  'profile.enable2fa': { en: 'Enable 2FA', ru: 'Включить 2FA' },
  'profile.authenticatorEnabled': { en: 'Authenticator enabled', ru: 'Аутентификатор включён' },
  'profile.disable': { en: 'Disable', ru: 'Отключить' },
  'profile.scanQr': {
    en: 'Scan the QR with your authenticator app (or enter the secret by hand), then type the code it shows.',
    ru: 'Отсканируйте QR приложением-аутентификатором (или введите секрет вручную), затем введите код, который оно покажет.'
  },
  'profile.qrAlt': { en: 'TOTP QR code', ru: 'QR-код TOTP' },
  'profile.verify': { en: 'Verify', ru: 'Проверить' },
  'profile.passkeys': { en: 'Passkeys', ru: 'Ключи доступа' },
  'profile.passkeysSoon': {
    en: 'Passwordless sign-in with a device key — coming soon.',
    ru: 'Вход без пароля с помощью ключа устройства — скоро.'
  },

  // Wallet
  'profile.gatoBalance': { en: '{n} GATO', ru: '{n} GATO' },
  'profile.toShop': { en: 'Shop', ru: 'Магазин' },
  'profile.gatoOwned': {
    en: 'Purchased items: {n} — unlocked in the avatar picker and skin gallery.',
    ru: 'Приобретено предметов: {n} — они разблокированы в выборе аватара и галерее скинов.'
  },
  'profile.buyInShop': { en: 'Buy in the Shop', ru: 'Купите в Магазине' },
  'profile.walletBlurb': {
    en: 'Link a wallet to carry your avatars, skins and arguments as NFTs once the blockchain layer ships. Metarchy stays a web2 game — any smart-contract chain can plug in.',
    ru: 'Привяжите кошелёк, чтобы носить аватары, скины и аргументы как NFT, когда появится блокчейн-слой. Metarchy остаётся web2-игрой — подключить можно любой смарт-контрактный блокчейн.'
  },
  'profile.comingSoon': { en: 'Coming soon', ru: 'Скоро' },
  'profile.noWallet': { en: 'No wallet linked.', ru: 'Кошелёк не привязан.' },

  // Tabs: what you ARE, what you HAVE, how you LOOK, and the account itself.
  'profile.tab.stats': { en: 'Stats', ru: 'Статистика' },
  'profile.tab.inventory': { en: 'Inventory', ru: 'Инвентарь' },
  'profile.tab.looks': { en: 'Appearance', ru: 'Внешний вид' },
  'profile.tab.account': { en: 'Account', ru: 'Аккаунт' },

  // Inventory
  'profile.inventoryBlurb': {
    en: 'Everything this account owns. Use it, or put it up on the Market for GATO.',
    ru: 'Всё, что есть у аккаунта. Используйте — или выставьте на Рынок за GATO.'
  },
  'profile.inventoryEmpty': {
    en: 'Nothing yet. Win ranked games for drops, or buy in the Shop.',
    ru: 'Пока пусто. Побеждайте в рейтинговых играх ради дропа или покупайте в Магазине.'
  },
  'profile.onTheMarket': { en: 'On the Market', ru: 'На Рынке' },
  'profile.inUse': { en: 'In use', ru: 'Используется' },
  'profile.wearIt': { en: 'Use', ru: 'Использовать' },
  'profile.sellIt': { en: 'Sell', ru: 'Продать' },
  'profile.askingPrice': { en: 'Asking price in GATO', ru: 'Цена в GATO' },
  'profile.toMarket': { en: 'Market', ru: 'Рынок' },

  // Actor skins / wardrobe
  'profile.skinsBlurb': {
    en: 'How your Actors look in conflicts. The Politician can also be built layer by layer. More skins arrive in the Shop.',
    ru: 'Как ваши Деятели выглядят в конфликтах. Политика можно собрать слой за слоем. Новые скины появятся в Магазине.'
  },
  'profile.customize': { en: 'Customize…', ru: 'Настроить…' },
  'profile.custom': { en: 'Custom', ru: 'Свой' },
  'profile.default': { en: 'Default', ru: 'Стандарт' },

  // Argument coins
  'profile.argumentCoins': { en: 'Argument coins', ru: 'Монеты Аргументов' },
  'profile.argumentsBlurb': {
    en: 'The coins you play Rock, Paper, Scissors and the Dummy with. The classic set is yours from the start; alloys are bought in the Shop and re-skin all four at once.',
    ru: 'Монеты, которыми вы играете Камень, Бумагу, Ножницы и Пустышку. Классический набор ваш с самого начала; сплавы покупаются в Магазине и меняют вид сразу всех четырёх.'
  },

  // Skin names
  'profile.skin.ceremonial': { en: 'Ceremonial', ru: 'Церемониальный' },
  'profile.skin.obsidian': { en: 'Obsidian', ru: 'Обсидиан' },
  'profile.skin.revolutionary': { en: 'Revolutionary', ru: 'Революционный' },
  'profile.skin.industrial': { en: 'Industrial', ru: 'Индустриальный' },
  'profile.skin.gilded': { en: 'Gilded', ru: 'Позолоченный' },
  'profile.skin.holo': { en: 'Holo', ru: 'Голо' },
  'profile.skin.chromeExo': { en: 'Chrome Exo', ru: 'Хром-экзо' },
  'profile.skin.ann': { en: 'Ann', ru: 'Анна' },
  'profile.skin.asa': { en: 'Asa', ru: 'Аса' },
  'profile.skin.okeesha': { en: 'Okeesha', ru: 'Окиша' },
  'profile.skin.matrix': { en: 'Matrix', ru: 'Матрица' },

  // Politician fitting room
  'profile.saveLoadoutFailed': {
    en: 'Could not save the loadout.',
    ru: 'Не удалось сохранить образ.'
  },
  'profile.body': { en: 'Body', ru: 'Тело' },
  'profile.outfit': { en: 'Outfit', ru: 'Наряд' },
  'profile.colorway': { en: 'Colorway', ru: 'Расцветка' },
  'profile.hair': { en: 'Hair', ru: 'Причёска' },
  'profile.color': { en: 'Color', ru: 'Цвет' },
  'profile.accessoryN': { en: 'Accessory {n}', ru: 'Аксессуар {n}' },
  'profile.saveLook': { en: 'Save look', ru: 'Сохранить образ' },
  'profile.resetDefault': { en: 'Reset to default', ru: 'Сбросить образ' },
  'profile.connectToSave': {
    en: 'Connect to save your look.',
    ru: 'Подключитесь, чтобы сохранить образ.'
  },

  // Costume names
  'profile.costume.cape': { en: 'Cape suit', ru: 'Костюм с плащом' },
  'profile.costume.coat': { en: 'Long coat', ru: 'Длинное пальто' },
  'profile.costume.gown': { en: 'Gown', ru: 'Платье' },

  // Accessory names
  'profile.accessory.glasses': { en: 'Glasses', ru: 'Очки' },
  'profile.accessory.visor': { en: 'Visor', ru: 'Визор' },
  'profile.accessory.mask': { en: 'Mask', ru: 'Маска' },
  'profile.accessory.respirator': { en: 'Respirator', ru: 'Респиратор' }
}
