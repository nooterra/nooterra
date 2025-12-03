import React from "react";
import { motion } from "framer-motion";
import { Users, Plus, Search, MoreVertical, Mail, Shield, Trash2, Edit2 } from "lucide-react";

type Member = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  avatar: string;
  joinedAt: string;
  lastActive: string;
};

const mockMembers: Member[] = [
  { id: "1", name: "Sarah Chen", email: "sarah@company.com", role: "owner", avatar: "S", joinedAt: "Jan 2024", lastActive: "Just now" },
  { id: "2", name: "Mike Johnson", email: "mike@company.com", role: "admin", avatar: "M", joinedAt: "Feb 2024", lastActive: "2 hours ago" },
  { id: "3", name: "Lisa Wang", email: "lisa@company.com", role: "admin", avatar: "L", joinedAt: "Mar 2024", lastActive: "1 day ago" },
  { id: "4", name: "John Smith", email: "john@company.com", role: "member", avatar: "J", joinedAt: "Apr 2024", lastActive: "3 days ago" },
  { id: "5", name: "Emma Davis", email: "emma@company.com", role: "member", avatar: "E", joinedAt: "May 2024", lastActive: "1 week ago" },
];

export default function Team() {
  const [members] = React.useState<Member[]>(mockMembers);
  const [search, setSearch] = React.useState("");
  const [showInvite, setShowInvite] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<"admin" | "member">("member");

  const filtered = members.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase())
  );

  const getRoleColor = (role: string) => {
    switch (role) {
      case "owner":
        return "bg-[#39ff8e]/10 text-[#39ff8e]";
      case "admin":
        return "bg-[#a855f7]/10 text-[#a855f7]";
      default:
        return "bg-[#4f7cff]/10 text-[#4f7cff]";
    }
  };

  return (
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Team Management</h1>
            <p className="text-[#707090] mt-1">Manage your organization members</p>
          </div>
          <button onClick={() => setShowInvite(true)} className="btn-neural">
            <Plus className="w-4 h-4" /> Invite Member
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#505060]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members..."
            className="w-full bg-[#0a0a12] border border-[#4f7cff]/20 rounded-xl pl-12 pr-4 py-3 text-white placeholder-[#505060] focus:border-[#a855f7]/40 focus:outline-none transition-all"
          />
        </div>

        {/* Members list */}
        <div className="bg-[#0a0a12] border border-[#4f7cff]/10 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[2fr,1fr,1fr,auto] gap-4 px-5 py-3 border-b border-[#4f7cff]/10 text-xs text-[#707090] uppercase tracking-wider">
            <div>Member</div>
            <div>Role</div>
            <div>Last Active</div>
            <div></div>
          </div>

          <div className="divide-y divide-[#4f7cff]/5">
            {filtered.map((member, i) => (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="grid grid-cols-[2fr,1fr,1fr,auto] gap-4 px-5 py-4 items-center hover:bg-[#4f7cff]/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#4f7cff] to-[#a855f7] flex items-center justify-center text-white font-medium">
                    {member.avatar}
                  </div>
                  <div>
                    <div className="text-white font-medium">{member.name}</div>
                    <div className="text-xs text-[#505060]">{member.email}</div>
                  </div>
                </div>

                <div>
                  <span className={`px-2 py-1 text-xs rounded-full ${getRoleColor(member.role)}`}>
                    {member.role}
                  </span>
                </div>

                <div className="text-sm text-[#707090]">{member.lastActive}</div>

                <div className="flex items-center gap-2">
                  {member.role !== "owner" && (
                    <>
                      <button className="p-2 text-[#505060] hover:text-white rounded-lg hover:bg-[#4f7cff]/10">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button className="p-2 text-[#505060] hover:text-red-400 rounded-lg hover:bg-red-500/10">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Invite modal */}
        {showInvite && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-[#0a0a12] border border-[#4f7cff]/20 rounded-2xl p-6 w-full max-w-md"
            >
              <h3 className="text-xl font-semibold text-white mb-2">Invite Team Member</h3>
              <p className="text-[#707090] text-sm mb-6">
                Send an invitation to join your organization
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-[#909098] mb-2">Email address</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white placeholder-[#505060] focus:border-[#a855f7]/50 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm text-[#909098] mb-2">Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                    className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-3 text-white focus:border-[#a855f7]/50 focus:outline-none"
                  >
                    <option value="member">Member - Can use workflows and agents</option>
                    <option value="admin">Admin - Can manage team and settings</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowInvite(false)}
                  className="px-4 py-2 text-[#707090] hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button className="btn-neural">
                  <Mail className="w-4 h-4" /> Send Invite
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}

