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
// 索引项结构
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

// ──────────────────────────────────────────────
// 提取并清洗搜索文本（保持不变）
// ──────────────────────────────────────────────
function buildSearchText(item: BQBItem): string {
  const cat = item.category
    .replace(/^\d+/, "")
    .replace(/BQB$/i, "")
    .replace(/[_]/g, " ")
    .replace(/[^\w\s\u4e00-\u9fff]/g, "")
    .trim();

  let namePart = item.name.replace(/\.[^.]+$/, "");

  if (/^[a-z0-9]{16,}$/i.test(namePart)) {
    namePart = "";
  } else {
    namePart = namePart.replace(/[-_]/g, " ");
    namePart = namePart.replace(/[^\w\s\u4e00-\u9fff]/g, " ");
    namePart = namePart.replace(/[a-z]+\d{4,}/gi, "").replace(/\b\d{4,}\b/g, "");
  }

  return `${cat} ${namePart}`.replace(/\s+/g, " ").trim().toLowerCase();
}

// ──────────────────────────────────────────────
// 内存缓存与单例异步加载
// ──────────────────────────────────────────────
let _fuse: Fuse<IndexedItem> | null = null;
let _loading: Promise<{ fuse: Fuse<IndexedItem>; allItems: IndexedItem[] }> | null = null;
let _allItems: IndexedItem[] | null = null;   // 新增：保留原始顺序的全量数据

async function getFuseIndex(): Promise<{ fuse: Fuse<IndexedItem>; allItems: IndexedItem[] }> {
  if (_fuse !== null && _allItems !== null) {
    return { fuse: _fuse, allItems: _allItems };
  }

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

      _allItems = indexed;

      _fuse = new Fuse(indexed, {
        keys: [{ name: "searchText", weight: 1.0 }],
        threshold: 0.3,
        ignoreLocation: true,
        includeScore: false,
        useExtendedSearch: true,
        shouldSort: true,
      });

      return { fuse: _fuse, allItems: indexed };
    })
    .catch((err) => {
      console.error("ChineseBQB index load failed:", err);
      throw err;
    })
    .finally(() => {
      _loading = null;
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
    const trimmedKw = keyword?.trim();

    let fuse: Fuse<IndexedItem>;
    let allItems: IndexedItem[];

    try {
      const index = await getFuseIndex();
      fuse = index.fuse;
      allItems = index.allItems;
    } catch {
      return { isEnd: true, images: [] };
    }

    if (!trimmedKw) {
      // 无搜索词时返回原始顺序的分页数据（不再使用固定默认词）
      const start = (pageIndex - 1) * PAGE_SIZE;
      const pageItems = allItems.slice(start, start + PAGE_SIZE);

      return {
        isEnd: start + PAGE_SIZE >= allItems.length,
        images: pageItems.map((item) => ({
          id: uuidv4(),
          url: item.raw.url,
        })),
      };
    } else {
      // 有搜索词时执行模糊搜索
      const results = fuse.search(trimmedKw);

      const start = (pageIndex - 1) * PAGE_SIZE;
      const pageItems = results.slice(start, start + PAGE_SIZE);

      return {
        isEnd: start + PAGE_SIZE >= results.length,
        images: pageItems.map(({ item }) => ({
          id: uuidv4(),
          url: item.raw.url,
        })),
      };
    }
  };
}