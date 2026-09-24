# 今晚月亮很好

这是一个中秋祝福静态单页。页面采用真实满月摄影与暮色湖景，配有三段日常祝福、六条可切换寄语、轻量音效、系统分享降级，以及可供访客留下祝福的共享祝福墙。

## 素材来源

- 满月摄影：Gregory H. Revera，来源为 Wikimedia Commons 的 `FullMoon2010.jpg`，依照 CC BY-SA 3.0 授权；本项目仅做了方形裁切、轻微对比调整和 WebP 格式转换
- 暮色湖景：W.carter，来源为 Wikimedia Commons 的 `Moon and clouds over Brofjorden 1.jpg`，CC0
- 南宋佚名《松阴玩月图》：大都会艺术博物馆公开图像，CC0
- 宣纸纹理：本地程序生成，仅作抽象质感使用

## 本地预览

在站点目录中运行：

```powershell
python -m http.server 8000
```

然后访问 `http://127.0.0.1:8000/`。也可以直接打开 `index.html`，页面不依赖服务器接口。

## 开启共享祝福墙

项目已经接入原来的 Supabase 项目。首次发布前，需要在 Supabase Dashboard 的 SQL Editor 中执行：

```text
supabase/migrations/202609250001_blessings.sql
```

执行后会创建 `mid_autumn_blessings` 表，并开启行级安全策略：

- 任何人都可以读取公开祝福。
- 匿名访客只能提交公开祝福，不能读取隐藏内容或修改他人的留言。
- 同一浏览器十分钟内最多提交五句，数据库和前端还会分别做一次基础限流。
- 如需隐藏某句祝福，可以在 Supabase 中把该记录的 `status` 改为 `hidden`。

数据库暂时不可用时，提交内容会保存在访客自己的浏览器中，并明确提示“仅在当前设备保存”，不会伪装成已公开。

## 部署

将整个目录上传到 GitHub Pages、Netlify、Vercel 或任意静态文件服务器即可。入口文件为 `index.html`，所有资源均为相对路径。
