# 与上游同步

本仓库是 `functy23/dsh-workbuddy-connect-functy` 的分支。上游仍在维护，这里的每次改动都要能跟上游的新提交合到一起，且**冲突面越小越好**。这份文档说明怎么同步，以及本仓库为此刻意遵守的约定。

> 与 `corrinehu/dsh-workbuddy-connect` 无关。那是更早的原始作者，两条线已经不共享代码；不需要、也不应该为它做兼容。

## 一次性配置

上游作为额外 remote 加进来（本仓库已配好，换台机器要重做）：

```sh
git remote add upstream https://github.com/functy23/dsh-workbuddy-connect-functy.git
git remote -v      # origin = 你的 fork，upstream = functy23
```

两个 remote 都验证过：`origin` 是你的 `adfnaa/...`，`upstream` 是 `functy23/...`。`main` 跟踪 `origin/main`。

## 同步上游

```sh
git fetch upstream
git log --oneline HEAD..upstream/main      # 先看上游多了什么
git rebase upstream/main                    # 或 git merge upstream/main
```

**推荐 rebase**：你的提交都叠在上游某个版本之上，rebase 之后历史是一条直线，之后提 PR 或再同步都不会产生无意义的合并提交。

rebase 撞冲突时：

```sh
git status                      # 看哪些文件冲突
# 逐个解决后：
git add <file>
git rebase --continue
# 想重来：
git rebase --abort
```

如果这次改动里 `.git/` 下的东西被碰过（比如本仓库的临时 commit message 文件），先确认 `git status` 干净再 rebase。

## 合并面统计

改完之后看一眼自己动了哪些文件、动了多少行，是判断「这次改动好不好合」最直接的办法：

```sh
git diff --stat upstream/main HEAD -- src
git diff --numstat upstream/main HEAD -- src | sort -rn
```

新增文件（`numstat` 里第二列是 0 的那些）几乎不可能冲突——上游不会去改一个它没有的文件。真正要留心的是**对上游已有文件的修改行数**。

## 本仓库为便于合并遵守的约定

这些不是风格偏好，每一条都是为了少一个冲突点：

1. **新功能尽量落成新文件。** 签到之所以是 `src/checkin.ts` + `src/checkin-scheduler.ts`，界面文案之所以是 `src/client/host-reason.ts` + `host-reason-copy.ts`，都是这个原因：上游改它自己的文件时不会碰到它们。

2. **改上游文件时，改动要窄且贴着已有结构。** 例如把宿主拒绝语翻成中文，只在**渲染那一行**包一层 `translateHostReason(t, ...)`，而不是给十几个 `setError` 调用点各加一个参数——后者会散落在整个文件里，上游动任何一处都可能撞上。

3. **不动 wire 协议。** 给状态文档加字段是**可选字段**（`checkIn?`），给路由加的是**新 action**。上游的宿主遇到新字段会忽略，本仓库的浏览器半边遇到旧宿主会退化。协议一变，两边就必须同时升级，合并时也就没有退路了。

4. **共用已有实现，不复制。** 签到的请求复用 `upstream.ts` 的 `billingBase` / `billingHeaders`（为此只把这两个函数加了 `export`，两行改动），而不是自己再拼一套 base URL 和 headers。复制一份意味着上游改协议时这里会悄悄不同步。

5. **新增配置字段加在既有字段旁边**，并沿用同一种写法（一个 `AUTO_CHECK_IN_FIELD` 常量、一个 `z.boolean().default(false)`），这样上游往 `CONFIG_FIELDS` 里加东西时，冲突只是相邻行而不是同一行的重写。

6. **`lib/` 是入库产物。** 改完源码必须 `pnpm run build` 再提交，否则装包的人拿到旧产物。构建产物由工具生成，冲突时**直接重新构建**，不要手工合并 `lib/` 里的内容：

   ```sh
   pnpm run build
   git add lib
   ```

7. **不要往 `README.md` / `README.en.md` 之间制造不对等。** 两份必须同步改（这是上游自己的规矩），否则下一次合并时两份的冲突点会不一样多。

## 冲突时怎么办

| 冲突的文件 | 处理 |
|---|---|
| `lib/**` | 不要手工合并。解决源码冲突后 `pnpm run build` 重新生成。 |
| 上游新增/改动的功能代码 | 以上游为准，把自己的改动重新叠上去。 |
| 自己新增的文件 | 一般不会冲突；真冲突说明上游也加了同名文件，需要改名。 |
| `package.json` 的依赖版本 | 取上游的版本（上游跟 DSH 的 peer 线），本地新增的 devDependency 保留。 |
| 文案/文档 | 两边都要：上游的新句子 + 本次的中文，别整段覆盖。 |

## 提交前检查

```sh
pnpm run typecheck
pnpm run test          # 注意：本机有若干平台相关用例本就失败，见下
pnpm run test:engine
pnpm run build
```

**已知的本机失败用例**（不是本次改动引入的）：`electron-discovery`、`auth` 的 WSL 路径、`desktop-doctor`、`desktop-credential-protection`、`host-heartbeat` 的 PID 回收、`model-visibility` 的文件权限——共 25 个，全部因为在 Windows 上跑 macOS/POSIX 语义的断言。判断有没有引入新失败，和基线比一比：

```sh
git stash push -u && pnpm run test 2>&1 | grep -c "×" && git stash pop
```
