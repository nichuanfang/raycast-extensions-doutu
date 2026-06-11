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
// 常量
// ──────────────────────────────────────────────
const JSON_URL =
  "https://raw.githubusercontent.com/zhaoolee/ChineseBQB/master/chinesebqb_github.json";

const PAGE_SIZE = 48;
const DEFAULT_KEYWORD = "哈哈";

// ──────────────────────────────────────────────
// 提取搜索文本（精简版）
// ──────────────────────────────────────────────
function buildSearchText(item: BQBItem): string {
  const cat = item.category
    .replace(/^\d+/, "")
    .replace(/BQB$/i, "")
    .replace(/[_]/g, " ")
    .replace(/[^\w\s\u4e00-\u9fff]/g, " ") // 移除 emoji 等
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  let namePart = item.name.replace(/\.[^.]+$/, ""); // 去扩展名

  // 跳过无意义名称（md5、纯数字）
  if (/^[a-f0-9]{16,}$/i.test(namePart) || /^\d+$/.test(namePart)) {
    namePart = "";
  } else if (namePart.includes("-")) {
    namePart = namePart.split("-").pop()!.trim();
  } else {
    namePart = namePart.replace(/\d+$/, "").trim();
  }

  return `${cat} ${namePart}`.replace(/\s+/g, " ").trim().toLowerCase();
}

// ──────────────────────────────────────────────
// 索引项
// ──────────────────────────────────────────────
interface IndexedItem {
  item: BQBItem;
  searchText: string;
}

// ──────────────────────────────────────────────
// 内存缓存
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
        item,
        searchText: buildSearchText(item),
      }));

      _fuse = new Fuse(indexed, {
        keys: [
          { name: "searchText", weight: 1.0 }, // 主搜索字段
        ],
        threshold: 0.4,        // 模糊匹配阈值，可根据需求调整
        ignoreLocation: true,
        includeScore: true,
        minMatchCharLength: 1,
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
// Source 实现
// ──────────────────────────────────────────────
export class ChineseBQBSource implements ISource {
  name = "ChineseBQB 🇨🇳";

  get = async (
    keyword: string | null,
    pageIndex: number,
  ): Promise<{ isEnd: boolean; images: IDoutuImage[] }> => {
    const kw = keyword?.trim() || DEFAULT_KEYWORD;

    let fuse: Fuse<IndexedItem>;
    try {
      fuse = await getFuseIndex();
    } catch {
      return { isEnd: true, images: [] };
    }

    // 执行模糊搜索
    const searchResults = fuse.search(kw);

    // 分页
    const start = (pageIndex - 1) * PAGE_SIZE;
    const pageItems = searchResults.slice(start, start + PAGE_SIZE);

    return {
      isEnd: start + PAGE_SIZE >= searchResults.length,
      images: pageItems.map(({ item }) => ({
        id: uuidv4(),
        url: item.item.url,
      })),
    };
  };
}