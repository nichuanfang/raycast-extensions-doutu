import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { v4 as uuidv4 } from "uuid";
const defaultKeyword = "hey";

export declare interface IDoutuImage {
  id: string;
  url: string;
}

export declare interface ISource {
  name: string;
  get(keyword: string | null, pageIndex: number): Promise<{ isEnd: boolean; images: IDoutuImage[] }>;
}

export class DouBiZJSJ implements ISource {
  name = "Source 1";
  get = async (keyword: string | null, pageIndex: number): Promise<{ isEnd: boolean; images: IDoutuImage[] }> => {
    keyword = keyword && keyword.trim() !== "" ? keyword : defaultKeyword;
    const response = await fetch(
      `https://www.dogetu.com/search.html?keyword=${encodeURIComponent(keyword)}&page=${pageIndex}`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    const $ = cheerio.load(await response.text());
    const nodes = $(".item-pic a > img").toArray();
    return {
      isEnd: nodes.length < 100,
      images: duplication(
        nodes.map((node) => ({ id: uuidv4(), url: node.attribs["src"] })),
        (o) => o.url,
      ),
    };
  };
}

export class DouTuSource implements ISource {
  name = "Source 2";
  get = async (keyword: string | null, pageIndex: number): Promise<{ isEnd: boolean; images: IDoutuImage[] }> => {
    keyword = keyword && keyword.trim() !== "" ? keyword : defaultKeyword;
    const url = pageIndex === 1
      ? `https://pdan.com.cn/?s=${encodeURIComponent(keyword)}`
      : `https://pdan.com.cn/page/${pageIndex}?s=${encodeURIComponent(keyword)}`;
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const $ = cheerio.load(await response.text());
    const nodes = $(".pin .pin-coat a.imageLink > img").toArray();
    return {
      isEnd: nodes.length < 100,
      images: duplication(
        nodes.map((node) => {
          const url = node.attribs["src"];
          return { id: uuidv4(), url: url.startsWith("http") ? url : `https://pdan.com.cn${url}` };
        }),
        (o) => o.url,
      ),
    };
  };
}

export class DouTuLaSource implements ISource {
  name = "Source 3";
  get = async (keyword: string | null, pageIndex: number): Promise<{ isEnd: boolean; images: IDoutuImage[] }> => {
    keyword = keyword && keyword.trim() !== "" ? keyword : defaultKeyword;
    const response = await fetch(
      `https://www.doutupk.com/search?type=photo&more=1&keyword=${keyword}&page=${pageIndex}`,
    );
    const $ = cheerio.load(await response.text());
    const nodes = $("img.image_dtb[data-original]").toArray();
    return {
      isEnd: nodes.length < 100,
      images: duplication(
        nodes.map((node) => {
          const url = node.attribs["data-original"] || node.attribs["data-backup"];
          return { id: uuidv4(), url: url.replace("http:", "https:") };
        }),
        (o) => o.url,
      ),
    };
  };
}

const duplication = <T>(listData: T[], filter: (item: T) => string): T[] => {
  const temp: { [key: string]: boolean } = {};
  return listData.reduce((item: T[], next) => {
    if (!temp[filter?.(next)]) {
      item.push(next);
      temp[filter?.(next)] = true;
    }
    return item;
  }, []);
};
