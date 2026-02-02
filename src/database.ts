import { UserData } from "./types";
import { writeFileSync, readFileSync, existsSync } from "fs"

const dbPath = "userData.json"

interface UserStore {
  [chatId: string]: UserData;
}
export class Database {
  db: UserStore;

  constructor() {
    this.db = {}
    this.loadFromDisk()
  }

  addUser(id: number, user: UserData) {
    this.db[id.toString()] = user;
    this.saveToDisk()
  }

  getUser(id: number): UserData | null {
    return this.db[id.toString()] ?? null;
  }

  loadFromDisk() {
    try {
      if (existsSync(dbPath)) {
        const data = readFileSync(dbPath, "utf8");
        this.db = JSON.parse(data);
      }

    } catch (error) {
      console.log(`error loading file ${error}`);
    }
  }

  saveToDisk() {
    try {
      const stringData = JSON.stringify(this.db, null, 2);
      writeFileSync(dbPath, stringData, "utf8")

    } catch (error) {
      console.log(`error writing file ${error}`)
    }
  }

}
