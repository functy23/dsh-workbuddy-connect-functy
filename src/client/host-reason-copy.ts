/**
 * How the host's own refusal sentences read, in both languages.
 *
 * A table of its own rather than rows in either dictionary, because BOTH
 * namespaces draw these sentences: the settings page (settings.workbuddy, via
 * the error banner and the add-account dialog) and the dashboard (panel.workbuddy,
 * via each product's detail line). Their keys live in two different unions, so
 * sharing the copy means sharing the values and letting each dictionary spread
 * them in — see `locales.ts` and `panel-copy.ts`.
 *
 * Keys here are plain strings rather than a union of their own: each host builds
 * its dictionary by spreading this record, so the key type is derived at the
 * spread site, which is what keeps `t` assignable from either registration's
 * locale seat (a seat accepts exactly its own namespace's keys).
 *
 * @module dsh-workbuddy-connect/client/host-reason-copy
 */

/** The refusals, in the language the host composes them in. */
export const HOST_REASON_EN = {
  hostSettingsUnavailable: 'This DSH host cannot persist settings right now.',
  hostSettingsWritesUnsupported: 'This DSH host does not accept settings writes. Restart DSH Desktop and try again.',
  hostUnknownCreditStyle: 'That sidebar credit style is not one this build knows.',
  hostStopping: 'The plugin is shutting down; try again in a moment.',
  hostVisibilityNeedsAccount: 'Hiding models needs a signed-in account with a stable user id.',
  hostAccountChanged: 'The signed-in account changed — this change was not saved.',
  hostNoSuchAccount: 'That account is no longer in the pool.',
  hostNoSuchModel: 'That model is no longer offered.',
  hostContextLengthUnsupported: 'That model does not offer that context length.',
  hostDesktopSignedOut: 'The desktop app holds no sign-in to read.',
  hostTokenRefused: 'The sign-in token was refused.',
  hostTokenReplaced: 'That account was already in the pool; its token was replaced.',
  hostTokensRefreshed: 'That account was already in the pool; its sign-in tokens were refreshed.',
  hostProbeUnauthorized: 'Detection is not authorized. Turn it on from the detection section first.',
  hostNoCredential: 'No WorkBuddy sign-in is available for this product.',
  hostProbeNotNeeded: 'That model does not need detection.',
  hostAccountChangedBeforeProbe: 'The account changed before detection started.',
  hostAccountChangedDuringProbe: 'The account changed while detection was running.',
  hostAccountRemovedWhileRefreshing: 'The account was removed while its balance was refreshing.',
  hostLinkUnsupported: 'Only absolute http and https links can be opened.',
  hostTokenUnreadable: 'That does not look like a sign-in token (its payload could not be read).',
  hostTokenIssuerUnknown: 'The token names an issuer this plugin does not recognise.',
  hostUnknownModel: 'Unknown model: {model}',
  hostWrongRegionToken: 'That is a {product} token; paste it into the matching product\'s dialog.',
  hostNoAccountYet: 'No account yet — sign in to the desktop app, or add one by QR here.',
  hostNoSignedInApp: 'No signed-in {app} account was found. Sign in once in the {app} desktop app, then try again.',
  hostSignInExpired: 'The sign-in expired and cannot be renewed. Sign in again in the {app} desktop app.',
  hostCredentialRegionMismatch: '{app} was pointed at a {other} credential. Point {env} at the {app} sign-in, or remove the mismatched file.',
  hostCheckInFailed: 'The check-in request failed.',
} as const

/** The same refusals in Chinese; every key above, in the same order. */
export const HOST_REASON_ZH = {
  hostSettingsUnavailable: '当前 DSH 宿主暂时无法保存设置。',
  hostSettingsWritesUnsupported: '当前 DSH 宿主不接受设置写入。请重启 DSH Desktop 后重试。',
  hostUnknownCreditStyle: '这个侧栏额度样式是本版本不认识的。',
  hostStopping: '插件正在关闭，请稍后重试。',
  hostVisibilityNeedsAccount: '隐藏模型需要先登录一个有稳定用户 ID 的账号。',
  hostAccountChanged: '登录账号已切换——本次修改未保存。',
  hostNoSuchAccount: '这个账号已不在账号池里。',
  hostNoSuchModel: '这个模型已经不再提供。',
  hostContextLengthUnsupported: '该模型不提供这个上下文长度。',
  hostDesktopSignedOut: '桌面 App 里没有可读取的登录状态。',
  hostTokenRefused: '登录令牌被拒绝了。',
  hostTokenReplaced: '该账号已在账号池里；它的令牌已被替换。',
  hostTokensRefreshed: '该账号已在账号池里；它的登录令牌已刷新。',
  hostProbeUnauthorized: '尚未授权检测。请先在检测分区里打开。',
  hostNoCredential: '该产品没有可用的 WorkBuddy 登录。',
  hostProbeNotNeeded: '该模型不需要检测。',
  hostAccountChangedBeforeProbe: '检测开始前账号已经切换。',
  hostAccountChangedDuringProbe: '检测进行中账号发生了切换。',
  hostAccountRemovedWhileRefreshing: '刷新余额时该账号已被移除。',
  hostLinkUnsupported: '只能打开绝对的 http 与 https 链接。',
  hostTokenUnreadable: '这不像是一个登录令牌（读不出里面的内容）。',
  hostTokenIssuerUnknown: '该令牌声明的签发方本插件不认识。',
  hostUnknownModel: '未知模型：{model}',
  hostWrongRegionToken: '这是一个 {product} 的令牌；请粘贴到对应产品的对话框里。',
  hostNoAccountYet: '还没有账号——可在桌面 App 登录，或在这里扫码添加。',
  hostNoSignedInApp: '没有找到已登录的 {app} 账号。请先在 {app} 桌面 App 里登录一次。',
  hostSignInExpired: '登录已过期且无法续期。请在 {app} 桌面 App 里重新登录。',
  hostCredentialRegionMismatch: '{app} 拿到了一份 {other} 的凭据。请把 {env} 指向 {app} 的登录，或删掉那份不匹配的文件。',
  hostCheckInFailed: '签到请求失败了。',
} satisfies Record<keyof typeof HOST_REASON_EN, string>

/**
 * The keys this table contributes to every dictionary that spreads it.
 *
 * Both namespaces (`settings.workbuddy` and `panel.workbuddy`) end up with
 * these keys, so {@link translateHostReason} is typed against THIS union rather
 * than against either dictionary's own. That is what lets one call site serve
 * both: a translator accepting its whole namespace's key union also accepts this
 * subset (the parameter is contravariant), so the settings page's `t` and the
 * dashboard's seat are both assignable without a cast.
 */
export type HostReasonKey = keyof typeof HOST_REASON_EN
