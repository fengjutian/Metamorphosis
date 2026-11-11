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

当前版本已经接入真正的三阶段 WebGL2 管线：

1. **Volume Pass**：将 `128³` 体素排列为 `16 × 8` 个切片，保存到两张 `2048 × 1024 RGBA16F` 图集并进行 ping-pong 更新；
2. **Scene Pass**：对体积距离场进行 sphere tracing 和体积积分，渲染天空、水面及二次体积反射，并在 Alpha 中保存深度；
3. **Image Pass**：执行景深、Bloom、God Rays、雾、色差、色调映射、调色、颗粒和宽银幕遮幅。

相关实现位于：

- `src/shaders.js`：Volume、Scene 与 Image 三个 GLSL Pass；
- `src/renderer.js`：图集寻址、浮点纹理、framebuffer 和三阶段调度；
- `src/main.jsx`：React 控制界面。

默认体积尺寸在 `src/renderer.js` 中设置：

```js
const volumeSize = 128;
const gridWidth = 16;
const gridHeight = 8;
```

`128³` 每帧需要处理 2,097,152 个体素，计算量很高。如果设备无法维持可接受的帧率，可将其降为：

```js
const volumeSize = 64;
const gridWidth = 8;
const gridHeight = 8;
```

64³ 模式已经通过软件 WebGL 渲染验证；128³ 模式可以成功构建和编译，但建议使用支持 WebGL2 浮点 framebuffer 的独立显卡运行。

也可以不修改源码，直接用查询参数启动轻量模式：

```text
http://127.0.0.1:5173/?volume=64
```

### 已实施的性能优化

- 程序化噪声与莲花目标场仅在形变数值变化时重新计算；
- 目标场与距离传播分离，静止收敛阶段不再重复计算六层噪声；
- 距离传播完成 128 次迭代后冻结整个 Volume Pass；
- 主视线体积积分上限由 640 降为 384；
- 水面反射体积积分上限由 260 降为 120；
- 提供 `?volume=64` 轻量运行档，同时保留默认 `128³` 输出。

## 浏览器要求

- 支持 WebGL2；
- 推荐使用最新版 Chrome、Edge 或 Firefox；
- 推荐独立显卡或性能较好的集成显卡；
- 高 DPI 屏幕可以在控制面板中降低渲染比例。

如果 WebGL2 初始化失败，页面会显示错误信息，而不会静默黑屏。

## 致谢与许可说明

本项目用于学习和本地技术实验。原始 Shader 的作者信息、署名和许可应以 Shadertoy 原页面为准。公开发布、再分发或用于商业项目之前，请先确认原作者设定的许可条件，并保留必要署名。
