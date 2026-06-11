import { v4 as uuidv4 } from "uuid";
import Fuse from "fuse.js";
import { IDoutuImage, ISource } from "./sources";

// ──────────────────────────────────────────────
// JSON 数据结构
// ──────────────────────────────────────────────
interface BQBItem {
  name: string;
  category: string;
  url: string;
}

interface BQBJson {
  status: number;
  info: string;
  data: BQBItem[];
}

// ──────────────────────────────────────────────
// 索引项结构（将 item 重命名为 raw，避免 item.item.url 的套娃尴尬）
// ──────────────────────────────────────────────
interface IndexedItem {
  raw: BQBItem;
  searchText: string;
}

// ──────────────────────────────────────────────
// 常量
// ──────────────────────────────────────────────
const JSON_URL =
  "https://raw.githubusercontent.com/zhaoolee/ChineseBQB/master/chinesebqb_github.json";

const PAGE_SIZE = 48;
const DEFAULT_KEYWORD = "哈哈";

// ──────────────────────────────────────────────
// 提取并清洗搜索文本
// ──────────────────────────────────────────────
function buildSearchText(item: BQBItem): string {
  // 1. 清洗分类名（如 "001Funny_滑稽大佬😏BQB" -> "funny 滑稽大佬"）
  const cat = item.category
    .replace(/^\d+/, "")                 // 去掉前导数字
    .replace(/BQB$/i, "")                // 去掉尾部 BQB
    .replace(/[_]/g, " ")                // 下划线变空格
    .replace(/[^\w\s\u4e00-\u9fff]/g, "") // 移除 emoji 和特殊符号
    .trim();

  // 2. 清洗文件名
  let namePart = item.name.replace(/\.[^.]+$/, ""); // 去掉扩展名 (.jpg / .gif)

  // 阻断形如 4c92b891ly1ghxdcssghij205k04u74a 的微博图床或 MD5 乱码 Hash
  if (/^[a-z0-9]{16,}$/i.test(namePart)) {
    namePart = "";
  } else {
    // 将连字符和下划线转换为空格，保留前后所有核心词（"精神病院欢迎您-你有病得治" -> "精神病院欢迎您 你有病得治"）
    namePart = namePart.replace(/[-_]/g, " ");
    
    // 去除中文标点，但允许保留英文、数字和中文
    namePart = namePart.replace(/[^\w\s\u4e00-\u9fff]/g, " ");

    // 剔除英文单词内部或结尾紧跟的 4 位及以上纯数字序号（如 contribution00001 -> contribution）
    // 但像 "110", "666" 这样独立的短数字梗会被完美保留
    namePart = namePart.replace(/[a-z]+\d{4,}/gi, "").replace(/\b\d{4,}\b/g, "");
  }

  // 3. 合并分类与名称，合并多余空格，转为小写
  return `${cat} ${namePart}`.replace(/\s+/g, " ").trim().toLowerCase();
}

// ──────────────────────────────────────────────
// 内存缓存与单例异步加载
// ──────────────────────────────────────────────
let _fuse: Fuse<IndexedItem> | null = null;
let _loading: Promise<Fuse<IndexedItem>> | null = null;

async function getFuseIndex(): Promise<Fuse<IndexedItem>> {
  if (_fuse !== null) return _fuse;
  if (_loading !== null) return _loading;

  _loading = fetch(JSON_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`ChineseBQB fetch failed: ${res.status}`);
      return res.json() as Promise<BQBJson>;
    })
    .then((json) => {
      const data = json.data ?? [];
      const indexed: IndexedItem[] = data.map((item) => ({
        raw: item,
        searchText: buildSearchText(item),
      }));

      // 初始化 Fuse.js 配置
      _fuse = new Fuse(indexed, {
        keys: [{ name: "searchText", weight: 1.0 }],
        threshold: 0.3,            // 针对中文微调阈值，防止风马牛不相及的错配
        ignoreLocation: true,      // 忽略关键词在文本中的位置
        includeScore: false,       // 关闭分值返回以略微提升性能
        useExtendedSearch: true,   // 关键：开启扩展搜索，支持多词空格组合搜索（如输入 "滑稽 110"）
        shouldSort: true,
      });

      _loading = null;
      return _fuse;
    })
    .catch((err) => {
      _loading = null;
      console.error("ChineseBQB index load failed:", err);
      throw err;
    });

  return _loading;
}

// ──────────────────────────────────────────────
// Source 接口实现
// ──────────────────────────────────────────────
export class ChineseBQBSource implements ISource {
  name = "ChineseBQB 🇨🇳";

  get = async (
    keyword: string | null,
    pageIndex: number,
  ): Promise<{ isEnd: boolean; images: IDoutuImage[] }> => {
    // 兼容空字符串或全空格输入
    const kw = keyword?.trim() ? keyword.trim() : DEFAULT_KEYWORD;

    let fuse: Fuse<IndexedItem>;
    try {
      fuse = await getFuseIndex();
    } catch {
      return { isEnd: true, images: [] };
    }

    // 执行模糊/扩展搜索
    const searchResults = fuse.search(kw);

    // 计算分页
    const start = (pageIndex - 1) * PAGE_SIZE;
    const pageItems = searchResults.slice(start, start + PAGE_SIZE);

    return {
      isEnd: start + PAGE_SIZE >= searchResults.length,
      // 这里的 item 是 Fuse 的包装对象，item.raw 才是我们定义的 IndexedItem 
      images: pageItems.map(({ item }) => ({
        id: uuidv4(),
        url: item.raw.url, 
      })),
    };
  };
}