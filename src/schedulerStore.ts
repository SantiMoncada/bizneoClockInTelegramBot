import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { resolveDataPath } from "./config.js";

export type ScheduledTask = {
  id: string;
  userId: number;
  lang: 'en' | 'es';
  locale: string;
  timeZone: string;
  scheduledTime: Date;
  createdAt: Date;
  executedAt?: Date;
  status: 'pending' | 'executed' | 'failed';
  error?: string;
}

type SerializedTask = Omit<ScheduledTask, 'scheduledTime' | 'createdAt' | 'executedAt'> & {
  scheduledTime: string;
  createdAt: string;
  executedAt?: string;
};

export class SchedulerStore {
  schedules: ScheduledTask[] = [];
  private filePath: string;

  constructor(filePath = resolveDataPath("scheduledTasks.json")) {
    this.filePath = filePath;
    const dir = path.dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    this.loadFromDisk();
  }

  private toSerializable(task: ScheduledTask): SerializedTask {
    return {
      ...task,
      scheduledTime: task.scheduledTime.toISOString(),
      createdAt: task.createdAt.toISOString(),
      executedAt: task.executedAt ? task.executedAt.toISOString() : undefined,
    };
  }

  private fromSerializable(task: SerializedTask): ScheduledTask {
    return {
      ...task,
      lang: task.lang ?? 'en',
      locale: task.locale ?? 'en',
      timeZone: task.timeZone ?? 'Europe/Madrid',
      scheduledTime: new Date(task.scheduledTime),
      createdAt: new Date(task.createdAt),
      executedAt: task.executedAt ? new Date(task.executedAt) : undefined,
    };
  }

  add(
    userId: number,
    scheduledTime: Date,
    lang: 'en' | 'es' = 'en',
    locale: string = 'en',
    timeZone: string = 'Europe/Madrid'
  ): ScheduledTask {
    const task: ScheduledTask = {
      id: randomUUID(),
      userId,
      lang,
      locale,
      timeZone,
      scheduledTime,
      createdAt: new Date(),
      status: 'pending',
    };

    this.schedules.push(task);
    this.saveToDisk();
    return task;
  }

  getPending(): ScheduledTask[] {
    return this.schedules
      .filter((task) => task.status === 'pending')
      .sort((a, b) => a.scheduledTime.getTime() - b.scheduledTime.getTime());
  }

  getByUser(userId: number): ScheduledTask[] {
    return this.schedules
      .filter((task) => task.userId === userId)
      .sort((a, b) => a.scheduledTime.getTime() - b.scheduledTime.getTime());
  }

  markExecuted(id: string, error?: Error | string): boolean {
    const task = this.schedules.find((item) => item.id === id);
    if (!task) return false;

    if (error) {
      task.status = 'failed';
      task.error = typeof error === 'string' ? error : error.message;
    } else {
      task.status = 'executed';
      task.executedAt = new Date();
    }

    this.saveToDisk();
    return true;
  }

  cancel(id: string): boolean {
    const task = this.schedules.find((item) => item.id === id);
    if (!task) return false;

    task.status = 'failed';
    task.error = 'cancelled';
    this.saveToDisk();
    return true;
  }

  saveToDisk() {
    try {
      const serialized = this.schedules.map((task) => this.toSerializable(task));
      writeFileSync(this.filePath, JSON.stringify(serialized, null, 2), "utf8");
    } catch (error) {
      console.log(`error writing file ${error}`);
    }
  }

  loadFromDisk() {
    try {
      if (!existsSync(this.filePath)) {
        this.schedules = [];
        return;
      }

      const data = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(data) as SerializedTask[];
      this.schedules = parsed.map((task) => this.fromSerializable(task));
    } catch (error) {
      console.log(`error loading file ${error}`);
      this.schedules = [];
    }
  }
}
