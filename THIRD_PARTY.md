# 第三方依赖与样本来源

本项目自有代码按根 LICENSE 的 MIT 条款提供；依赖保持各自许可证，不能把整个依赖树称为 MIT。本次通过 npm 引用依赖，没有复制、扁平化或修改上游源码。完整依赖解析与完整性摘要固定在 package-lock.json。

| 直接依赖 | 固定版本 | 包内声明许可证 | 用途与上游 |
| --- | --- | --- | --- |
| @ethereumjs/block | 10.1.3 | MPL-2.0 | [EthereumJS](https://github.com/ethereumjs/ethereumjs-monorepo)：主网硬分叉区块头编码与哈希 |
| @ethereumjs/common | 10.1.3 | MIT | EthereumJS：主网硬分叉参数 |
| @ethereumjs/mpt | 10.1.3 | MPL-2.0 | EthereumJS：账户 MPT 路径核验 |
| @ethereumjs/util | 10.1.3 | MPL-2.0 | EthereumJS：账户 RLP 解码及字节编码 |
| viem | 2.57.3 | MIT | [viem](https://github.com/wevm/viem)：Keccak、EIP-712 签名恢复；本地测试签名 |
| zod | 4.6.5 | MIT | [Zod](https://github.com/colinhacks/zod)：严格共享 schema 与类型 |
| canonicalize | 5.1.0 | Apache-2.0 | [canonicalize](https://github.com/erdtman/canonicalize)：RFC 8785 序列化 |
| jsonc-parser | 3.3.1 | MIT | [jsonc-parser](https://github.com/microsoft/node-jsonc-parser)：JSON 语法树，用于拒绝重复键和非严格 JSON |
| TypeScript | 5.9.3 | Apache-2.0 | [TypeScript](https://github.com/microsoft/TypeScript)：构建与类型检查 |
| tsx | 4.23.15 | MIT | [tsx](https://github.com/privatenumber/tsx)：测试与样本工具运行 |
| @types/node | 22.19.0 | MIT | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped)：Node 类型 |

许可证按本次实际安装的 package.json 核对；依赖自身的许可文本随包分发。若以后修改或再分发依赖源码，按该依赖的许可证保留通知及相应源码要求。

运行时固定为 Node.js 22.23.3 / npm 10.9.9。开发机从 [Node.js 官方分发目录](https://nodejs.org/dist/v22.23.3/)下载 Linux x64 运行时并核对 SHA-256：`df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de`。本地运行时未提交，其他平台按 .nvmrc 安装对应官方构建。

真实链上样本的采集方法、来源、文件摘要与限制见 [初始样本](fixtures/core/ethereum-mainnet-26134149/README.md) 和 [扩展数据集](fixtures/core/mainnet-corpus/README.md)。公开账本事实由 RPC 读取，不是复制第三方代码或商业事故数据集；不声称对外部服务、地址或其标识拥有权利。演示签名由本地临时密钥生成，不是 RPC 厂商签名。

技术依据：[EIP-1186](https://eips.ethereum.org/EIPS/eip-1186)、[EIP-712](https://eips.ethereum.org/EIPS/eip-712)、[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)。PI、模型和链上写入未接入。
