# Metamorphosis Volume

一个使用 React、Vite 和 WebGL2 实现的实时着色器实验，目标是将 Shadertoy 作品 **Metamorphosis Volume** 移植到本地浏览器运行。

原作展示了一个漂浮在水面上的体积对象，在湍流噪声球与莲花之间缓慢变形，并结合水面反射、夕阳、景深、Bloom、大气雾和 God Rays 等效果。

> 原作：<https://www.shadertoy.com/view/NXySRV>  
> 作者：dathor  
> 原作部分技术基于 FabriceNeyret2 的 Volumetric Perlin to exact SDF。

## 本地运行

需要安装 Node.js 20 或更高版本。

```powershell
cd D:\github\Metamorphosis
npm install
npm run dev
```

然后访问：

```text
http://127.0.0.1:5173/
```

生产构建：

```powershell
npm run build
```

构建结果位于 `dist/`。

## 项目结构

```text
Metamorphosis/
├─ src/
│  ├─ main.jsx       React 页面和交互控制
│  ├─ renderer.js    WebGL2 渲染器与 GLSL Shader
│  └─ styles.css     页面及控制面板样式
├─ index.html
├─ package.json
└─ README.md
```

## 原始渲染管线

原始作品由三个 Pass 组成：

```text
Volume Buffer（128 × 128 × 128）
        │
        │ 三维距离场
        ▼
Scene Buffer（体积、天空和水面）
        │
        │ RGB 颜色 + Alpha 深度
        ▼
Image Pass（电影化后处理）
        │
        ▼
      屏幕
```

### 1. Volume Buffer

入口函数为：

```glsl
void mainVolume(out vec4 color, vec3 voxel)
```

它与普通的二维 `mainImage` 不同：`voxel` 是一个三维体素坐标。体积尺寸为：

```text
128 × 128 × 128 = 2,097,152 个体素
```

红色通道主要保存当前体素到形状表面的有符号距离：

```text
distance > 0    形状外部
distance = 0    形状表面
distance < 0    形状内部
```

这一 Pass 完成以下工作：

- 生成六层三维 Perlin turbulence；
- 构造噪声球隐式场；
- 使用多圈椭球 SDF 构造莲花；
- 在球体与莲花之间插值；
- 从上一帧读取相邻体素；
- 通过迭代传播得到可用于 sphere tracing 的近似距离场。

Volume Buffer 需要读取自身的上一帧，因此实际实现需要两份纹理交替读写，也就是 ping-pong buffer：

```text
第 N 帧：   Texture A → Texture B
第 N+1 帧： Texture B → Texture A
```

### 2. Scene Buffer

Scene Pass 读取 Volume Buffer，并完成主要场景渲染：

- 使用距离场快速穿过空白空间；
- 进入形状后进行固定步长的体积积分；
- 根据 Beer–Lambert 定律累计颜色和透射率；
- 通过距离场中心差分计算法线；
- 计算漫反射、高光、Fresnel 和逆光透射；
- 生成程序化水面波纹；
- 再次进行体积采样以产生水面反射；
- 在 Alpha 通道中保存场景深度。

Scene Pass 还把太阳的屏幕位置写入左下角的特殊像素：

```glsl
fragColor = vec4(sunScreenPosition, sunFacing, skyDepth);
```

Image Pass 会读取这个像素，确定 God Rays 的中心和强度。

### 3. Image Pass

最终 Pass 读取 Scene Buffer，执行：

- Karis 亮度加权预过滤；
- 屏幕边缘色差；
- 基于深度的景深；
- 黄金角圆盘采样 Bloom；
- 程序化大气雾；
- 以太阳位置为中心的屏幕空间 God Rays；
- Reinhard 色调映射；
- Gamma 校正；
- 冷阴影、暖高光调色；
- 暗角、颗粒和淡入淡出；
- 2.35:1 电影宽屏遮幅。

## `128³ mainVolume` 与 WebGL2

`mainVolume` 是 Shadertoy 提供的特殊体积 Shader 入口，并不是标准 WebGL GLSL 函数。普通 WebGL2 Fragment Shader 一次只输出一个二维像素，因此不能原样运行该入口。

移植时通常有两种实现方式。

### 真实三维纹理

使用 `TEXTURE_3D` 保存 `128³` 个体素。WebGL2 可以采样三维纹理，但缺少 compute shader 和 geometry shader，不容易在一次绘制中写入所有纹理层。

### 二维切片图集

把 128 张 `128 × 128` 的体积切片排列到一张二维纹理中。例如使用 `16 × 8` 布局：

```text
最终图集尺寸：2048 × 1024

z00  z01  z02  ...  z15
z16  z17  z18  ...  z31
 ...
z112 z113 z114 ...  z127
```

这种方案能通过一次全屏绘制更新所有体素，更适合标准 WebGL2。

## 当前实现状态

当前 `src/renderer.js` 是可以运行的 React/WebGL2 视觉原型，包含：

- 球体到莲花的程序化 SDF 形变；
- 关键视觉材质与夕阳天空；
- 水面及反射；
- 电影宽屏、调色、暗角和颗粒；
- 自动形变、手动形变、暂停和渲染比例控制。

当前版本仍是单个 WebGL2 Fragment Shader 的近似实现，**尚未完整接入原始的三阶段 Volume → Scene → Image 管线**。因此它可以表现相似主题，但不是三个原始 Shader 文件的逐 Pass 等价输出。

完整移植还需要：

1. 将 `mainVolume` 转换为二维切片图集计算；
2. 为 Volume Buffer 实现浮点纹理 ping-pong；
3. 实现三维坐标到切片图集坐标的映射与插值；
4. 将 Scene Pass 渲染到带浮点深度 Alpha 的离屏纹理；
5. 接入原始 Image Pass；
6. 根据设备性能选择 `64³`、`96³` 或 `128³` 体积质量。

## 浏览器要求

- 支持 WebGL2；
- 推荐使用最新版 Chrome、Edge 或 Firefox；
- 推荐独立显卡或性能较好的集成显卡；
- 高 DPI 屏幕可以在控制面板中降低渲染比例。

如果 WebGL2 初始化失败，页面会显示错误信息，而不会静默黑屏。

## 致谢与许可说明

本项目用于学习和本地技术实验。原始 Shader 的作者信息、署名和许可应以 Shadertoy 原页面为准。公开发布、再分发或用于商业项目之前，请先确认原作者设定的许可条件，并保留必要署名。
