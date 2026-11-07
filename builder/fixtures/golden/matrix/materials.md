# 来源资料 · 矩阵变换

> 本文件是 PageRef P2 黄金用例（`matrix`）的自编教学资料，仅用于构建评估，不来自真实用户上传，不进入用户数据。
> `section_id` 与 `brief.json` 的 `source_excerpts` 一一对应；公式使用 KaTeX 语法。

## section_id 201 · 线性变换与矩阵的列观点

二维线性变换 $T$ 把平面向量映射为平面向量，并保持加法与数乘：$T(u+v)=T(u)+T(v)$，$T(cu)=cT(u)$。选定标准基 $e_1=(1,0)$、$e_2=(0,1)$ 后，$T$ 完全由 $T(e_1)$、$T(e_2)$ 决定。

把这两个像向量作为列排成矩阵 $A=[T(e_1)\ T(e_2)]$，则任意向量 $x=(x_1,x_2)$ 的像为 $Ax=x_1T(e_1)+x_2T(e_2)$。因此“矩阵乘向量”的几何含义是：用输入向量的坐标对矩阵的列做线性组合。

单位矩阵对应恒等变换；矩阵 $\begin{bmatrix}2&0\\0&3\end{bmatrix}$ 把横坐标拉伸 2 倍、纵坐标拉伸 3 倍；矩阵 $\begin{bmatrix}1&1\\0&1\end{bmatrix}$ 是水平剪切，把正方形推成平行四边形，底边保持不动。判断一个矩阵表示什么变换，最直接的方法是看它的两列：第一列是 $e_1$ 的像，第二列是 $e_2$ 的像。

以剪切矩阵 $S=\begin{bmatrix}1&1\\0&1\end{bmatrix}$ 和输入 $x=(2,1)$ 为例：$Sx=2\begin{bmatrix}1\\0\end{bmatrix}+1\begin{bmatrix}1\\1\end{bmatrix}=\begin{bmatrix}3\\1\end{bmatrix}$。这表示先把第一列取 2 份、第二列取 1 份再相加，而不是把矩阵的某个元素单独乘以输入。理解这一点，可以避免把矩阵乘法误算成“对应位置相乘”。

## section_id 202 · 复合变换与矩阵乘法

若先做变换 $A$，再做变换 $B$，复合变换为 $B(Ax)=(BA)x$，即复合矩阵是 $B$ 左乘 $A$。矩阵乘法不满足交换律：先旋转再剪切，与先剪切再旋转，结果不同。

以逆时针旋转 $90^\circ$ 的 $R=\begin{bmatrix}0&-1\\1&0\end{bmatrix}$ 与水平剪切的 $S=\begin{bmatrix}1&1\\0&1\end{bmatrix}$ 为例：

$$SR=\begin{bmatrix}1&1\\0&1\end{bmatrix}\begin{bmatrix}0&-1\\1&0\end{bmatrix}=\begin{bmatrix}1&-1\\1&0\end{bmatrix}$$

$$RS=\begin{bmatrix}0&-1\\1&0\end{bmatrix}\begin{bmatrix}1&1\\0&1\end{bmatrix}=\begin{bmatrix}0&-1\\1&1\end{bmatrix}$$

两者不同，说明变换顺序不可交换。验证方法：取 $e_1=(1,0)$，先做 $R$ 得到 $(0,1)$，再做 $S$ 得到 $(1,1)$，与 $SR$ 的第一列一致。矩阵乘法满足结合律 $(AB)C=A(BC)$，因此多步变换可以按顺序连续相乘，但每一步的左乘顺序不能随意调换。读复合变换时，应从最内层开始，按矩阵从右到左的顺序执行。

## section_id 203 · 行列式、面积与可逆性

二阶矩阵 $A=\begin{bmatrix}a&b\\c&d\end{bmatrix}$ 的行列式为 $\det A=ad-bc$。几何上，$|\det A|$ 是单位正方形经 $A$ 变换后的面积，符号表示定向：$\det A>0$ 保持定向，$\det A<0$ 翻转定向。

$\det A=0$ 表示变换把平面压到一条直线或一个点，两列线性相关，矩阵不可逆，信息丢失且无法还原。例如 $\begin{bmatrix}1&2\\2&4\end{bmatrix}$ 的两列成比例，$\det A=1\times4-2\times2=0$，整个平面被压到一条直线上。旋转矩阵的行列式为 1，面积不变；剪切矩阵的行列式也为 1，面积不变但形状改变；缩放矩阵 $\begin{bmatrix}2&0\\0&3\end{bmatrix}$ 的行列式为 6，面积变为原来的 6 倍。

当 $\det A\neq 0$ 时，逆矩阵为

$$A^{-1}=\frac{1}{\det A}\begin{bmatrix}d&-b\\-c&a\end{bmatrix}$$

它表示撤销该变换。以旋转 $R$ 为例，$\det R=1$，$R^{-1}=\begin{bmatrix}0&1\\-1&0\end{bmatrix}$，即顺时针旋转 $90^\circ$，符合直觉。
