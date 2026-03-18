import { useState } from "react";
import { UserPlus, Shield, Wrench, MessageSquare, Trash2, Edit2, Save, X } from "lucide-react";
import type { UserRole } from "../RoleContext";
import { InstallersManager } from "../InstallerAssignment";

interface AppUser {
  id: string;
  name: string;
  role: UserRole;
  phone: string;
  email: string;
  createdAt: string;
}

const ROLE_CFG: Record<UserRole, { label: string; icon: React.ReactNode; color: string }> = {
  admin: { label: "Администратор", icon: <Shield size={14} />, color: "bg-purple-100 text-purple-700" },
  manager: { label: "Менеджер", icon: <MessageSquare size={14} />, color: "bg-blue-100 text-blue-700" },
  installer: { label: "Монтажник", icon: <Wrench size={14} />, color: "bg-amber-100 text-amber-700" },
};

const DEMO_USERS: AppUser[] = [
  { id: "1", name: "Олександр Капелан", role: "admin", phone: "+380501234567", email: "admin@kapelan.ua", createdAt: "2025-01-15" },
  { id: "2", name: "Марія Коваленко", role: "manager", phone: "+380671234567", email: "maria@kapelan.ua", createdAt: "2025-03-20" },
  { id: "3", name: "Іван Петренко", role: "installer", phone: "+380931234567", email: "ivan@kapelan.ua", createdAt: "2025-05-10" },
  { id: "4", name: "Дмитро Сидоренко", role: "installer", phone: "+380661234567", email: "dmytro@kapelan.ua", createdAt: "2025-06-01" },
];

export function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>(DEMO_USERS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", role: "installer" as UserRole, phone: "", email: "" });

  const handleAdd = () => {
    const newUser: AppUser = {
      id: `u_${Date.now()}`,
      name: form.name,
      role: form.role,
      phone: form.phone,
      email: form.email,
      createdAt: new Date().toISOString().split("T")[0],
    };
    setUsers(prev => [...prev, newUser]);
    setForm({ name: "", role: "installer", phone: "", email: "" });
    setShowAdd(false);
  };

  const handleRoleChange = (userId: string, newRole: UserRole) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
  };

  const handleDelete = (userId: string) => {
    setUsers(prev => prev.filter(u => u.id !== userId));
  };

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Пользователи</h2>
          <p className="text-sm text-slate-500 mt-0.5">Управление ролями и доступом</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 bg-blue-600 text-white rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-blue-700 transition-colors"
        >
          <UserPlus size={16} />
          Добавить
        </button>
      </div>

      {/* Add user form */}
      {showAdd && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h3 className="text-base font-bold text-slate-700">Новый пользователь</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Имя"
              className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value as UserRole }))}
              className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="admin">Администратор</option>
              <option value="manager">Менеджер</option>
              <option value="installer">Монтажник</option>
            </select>
            <input
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="Телефон"
              className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="Email"
              className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={!form.name} className="bg-blue-600 text-white rounded-xl px-5 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              <Save size={14} className="inline mr-1" /> Сохранить
            </button>
            <button onClick={() => setShowAdd(false)} className="text-slate-500 hover:text-slate-700 px-4 py-2 text-sm">
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Имя</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Роль</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Телефон</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Email</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-slate-50/50">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-slate-600 text-xs font-bold">
                        {user.name.charAt(0)}
                      </div>
                      <span className="font-semibold text-slate-800">{user.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <select
                      value={user.role}
                      onChange={e => handleRoleChange(user.id, e.target.value as UserRole)}
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full border-0 cursor-pointer ${ROLE_CFG[user.role].color}`}
                    >
                      <option value="admin">Администратор</option>
                      <option value="manager">Менеджер</option>
                      <option value="installer">Монтажник</option>
                    </select>
                  </td>
                  <td className="px-5 py-3.5 text-slate-600 hidden sm:table-cell">{user.phone}</td>
                  <td className="px-5 py-3.5 text-slate-600 hidden md:table-cell">{user.email}</td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => handleDelete(user.id)}
                      className="text-slate-400 hover:text-red-500 transition-colors p-1"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Installers management - persisted to backend */}
      <div className="border-t border-slate-200 pt-6">
        <InstallersManager />
      </div>
    </div>
  );
}