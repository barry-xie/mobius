export interface TaskTopic {
  topicId: string;
  topicName: string;
  subtopics: { subtopicId: string; subtopicName: string }[];
}

export interface TaskUnit {
  unitId: string;
  unitName: string;
  topics: TaskTopic[];
}

export interface Task {
  id: string;
  courseId: string;
  courseName: string;
  name: string;
  deadline: string; // ISO date string (YYYY-MM-DD)
  units: TaskUnit[];
  createdAt: string;
}

const TASKS_KEY = "knot_tasks";

export function getTasks(): Task[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getTasksForCourse(courseId: string): Task[] {
  return getTasks().filter((t) => t.courseId === courseId);
}

export function saveTask(task: Task): void {
  const tasks = getTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) tasks[idx] = task;
  else tasks.push(task);
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

export function deleteTask(taskId: string): void {
  const tasks = getTasks().filter((t) => t.id !== taskId);
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
