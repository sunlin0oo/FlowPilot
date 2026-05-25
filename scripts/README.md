# scripts 脚本说明

本目录放置 FlowPilot 运行时辅助脚本。脚本通常用于本地 helper 服务、短信/邮件验证码读取，或独立排查某个收码接口。

## Cloudflare Temp Email 最近验证码

脚本：`fetch_cloudflare_temp_email_code.js`

用途：输入邮箱地址、TempAPI 地址和 Admin Auth，调用 Cloudflare Temp Email 的 `/admin/mails` 接口，返回该邮箱最近一封验证码邮件中的验证码。脚本会优先按 `address` 查询；如果没有命中，会再拉取最近邮件并按 `original_recipient` 兜底匹配转发场景。

命令：

```powershell
node scripts\fetch_cloudflare_temp_email_code.js --email <邮箱地址> --temp-api <TempAPI地址> --admin-auth <AdminAuth>
```

位置参数写法：

```powershell
node scripts\fetch_cloudflare_temp_email_code.js <邮箱地址> <TempAPI地址> <AdminAuth>
```

返回 JSON 详情：

```powershell
node scripts\fetch_cloudflare_temp_email_code.js --email <邮箱地址> --temp-api <TempAPI地址> --admin-auth <AdminAuth> --json
```

可选参数：

- `--custom-auth <CustomAuth>`：当 TempAPI 同时要求 `x-custom-auth` 时使用。
- `--limit <数量>`：读取邮件数量，默认 `20`。
- `--timeout-ms <毫秒>`：请求超时时间，默认 `20000`。

输出：

- 默认只输出验证码，例如 `123456`。
- 加 `--json` 后输出 `code / email / mailId / subject / from / receivedDateTime`。

## Hotmail 本地邮件 helper

脚本：`hotmail_helper.py`

用途：启动本地 HTTP 服务，供扩展通过 Hotmail/Outlook refresh token 拉取邮件、提取验证码，并同步账号运行记录快照。默认监听 `http://127.0.0.1:17373`。

启动命令：

```powershell
python scripts\hotmail_helper.py
```

接口：

- `POST /messages`：按 `email / clientId / refreshToken` 拉取邮件列表。
- `POST /code`：按同样账号参数拉取邮件并返回最新验证码。
- `POST /sync-account-run-records`：同步账号运行记录快照到 `data/account-run-history.json`。
- `POST /append-account-log`：追加账号运行日志到 `data/account-run-history.txt`。

常用请求体字段：

- `email`：Hotmail/Outlook 邮箱。
- `clientId`：OAuth client id。
- `refreshToken`：refresh token。
- `mailbox` 或 `mailboxes`：邮箱目录，默认 `INBOX`。
- `top`：读取数量，最大 `30`。
- `senderFilters / subjectFilters / requiredKeywords / codePatterns`：验证码筛选规则，通常由扩展自动传入。

## GPC GoPay macOS 短信 helper

脚本：`gpc_sms_helper_macos.py`

用途：在接收 iPhone 短信转发的 Mac 上运行，读取 macOS Messages 数据库中的 GoPay/OpenAI OTP 短信，并通过本地 HTTP 接口返回最新验证码。默认监听 `http://127.0.0.1:18767`。

启动命令：

```bash
python3 scripts/gpc_sms_helper_macos.py
```

自定义监听端口和 Messages 数据库：

```bash
python3 scripts/gpc_sms_helper_macos.py --host 127.0.0.1 --port 18767 --db ~/Library/Messages/chat.db
```

可选参数：

- `--interval <秒>`：短信扫描间隔，默认 `2.0`。
- `--no-keywords`：不要求短信包含 GPC/OpenAI 关键词，直接接受数字 OTP。

接口：

- `GET /health`：查看 helper 状态。
- `GET /otp` 或 `GET /latest-otp`：返回最新 OTP。

常用查询参数：

- `after_ms` 或 `after`：只返回该时间戳之后的验证码。
- `phone` / `phone_e164` / `phone_number`：按手机号筛选。
- `consume=1`：读取后消费该 OTP，避免重复使用。

注意：该脚本仅适用于 macOS，因为它需要读取 `~/Library/Messages/chat.db`。
