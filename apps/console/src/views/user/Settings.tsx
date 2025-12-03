import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useDisconnect, useAccount } from "wagmi";
import {
  User,
  Bell,
  Webhook,
  Shield,
  LogOut,
  Wallet,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  ExternalLink,
  Copy,
  Loader2,
  Save,
  Play,
  Link2,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { shortenAddress } from "../../lib/web3";

const COORD_URL = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

type Tab = "profile" | "notifications" | "webhooks" | "security";

interface Webhook {
  id: string;
  url: string;
  events: string[];
  created_at: string;
  last_triggered_at?: string;
  last_status?: number;
}

interface NotificationPrefs {
  emailNotifications: boolean;
  discordWebhook: string | null;
  notifyOnWorkflowComplete: boolean;
  notifyOnLowCredits: boolean;
  lowCreditsThreshold: number;
}

export default function Settings() {
  const { user, logout } = useAuth();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Notification prefs
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>({
    emailNotifications: true,
    discordWebhook: null,
    notifyOnWorkflowComplete: true,
    notifyOnLowCredits: true,
    lowCreditsThreshold: 100,
  });

  // Webhooks
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["workflow.completed"]);

  useEffect(() => {
    if (activeTab === "notifications") fetchNotificationPrefs();
    if (activeTab === "webhooks") fetchWebhooks();
  }, [activeTab]);

  const fetchNotificationPrefs = async () => {
    const token = localStorage.getItem("nooterra_token");
    if (!token) return;

    setLoading(true);
    try {
      const res = await fetch(`${COORD_URL}/v1/users/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setNotifPrefs(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch notification prefs:", err);
    } finally {
      setLoading(false);
    }
  };

  const saveNotificationPrefs = async () => {
    const token = localStorage.getItem("nooterra_token");
    if (!token) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${COORD_URL}/v1/users/notifications`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(notifPrefs),
      });
      if (res.ok) {
        setSuccess("Notification preferences saved");
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError("Failed to save preferences");
      }
    } catch (err) {
      setError("Failed to save preferences");
    } finally {
      setSaving(false);
    }
  };

  const fetchWebhooks = async () => {
    const token = localStorage.getItem("nooterra_token");
    if (!token) return;

    setLoading(true);
    try {
      const res = await fetch(`${COORD_URL}/v1/webhooks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setWebhooks(data.webhooks || []);
      }
    } catch (err) {
      console.error("Failed to fetch webhooks:", err);
    } finally {
      setLoading(false);
    }
  };

  const addWebhook = async () => {
    if (!newWebhookUrl.trim()) return;
    
    const token = localStorage.getItem("nooterra_token");
    if (!token) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${COORD_URL}/v1/webhooks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          url: newWebhookUrl,
          events: selectedEvents,
        }),
      });
      if (res.ok) {
        setNewWebhookUrl("");
        fetchWebhooks();
        setSuccess("Webhook added successfully");
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError("Failed to add webhook");
      }
    } catch (err) {
      setError("Failed to add webhook");
    } finally {
      setSaving(false);
    }
  };

  const deleteWebhook = async (id: string) => {
    const token = localStorage.getItem("nooterra_token");
    if (!token) return;

    try {
      const res = await fetch(`${COORD_URL}/v1/webhooks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setWebhooks(webhooks.filter(w => w.id !== id));
      }
    } catch (err) {
      console.error("Failed to delete webhook:", err);
    }
  };

  const testWebhook = async (id: string) => {
    const token = localStorage.getItem("nooterra_token");
    if (!token) return;

    try {
      const res = await fetch(`${COORD_URL}/v1/webhooks/${id}/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setSuccess("Webhook test successful!");
      } else {
        setError(`Webhook test failed: ${data.message}`);
      }
      setTimeout(() => { setSuccess(null); setError(null); }, 3000);
    } catch (err) {
      setError("Failed to test webhook");
    }
  };

  const handleLogout = () => {
    disconnect();
    logout();
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tabs = [
    { id: "profile", label: "Profile", icon: <User className="w-4 h-4" /> },
    { id: "notifications", label: "Notifications", icon: <Bell className="w-4 h-4" /> },
    { id: "webhooks", label: "Webhooks", icon: <Webhook className="w-4 h-4" /> },
    { id: "security", label: "Security", icon: <Shield className="w-4 h-4" /> },
  ];

  const eventOptions = [
    { id: "workflow.completed", label: "Workflow Completed" },
    { id: "workflow.failed", label: "Workflow Failed" },
    { id: "credits.low", label: "Low Credits Alert" },
    { id: "agent.error", label: "Agent Error" },
  ];

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-8">Settings</h1>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? "bg-[#4f7cff] text-white"
                  : "text-[#909098] hover:text-white hover:bg-[#4f7cff]/10"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Success/Error Messages */}
        {(success || error) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`mb-6 p-4 rounded-xl flex items-center gap-2 ${
              success
                ? "bg-[#39ff8e]/10 border border-[#39ff8e]/20 text-[#39ff8e]"
                : "bg-red-500/10 border border-red-500/20 text-red-400"
            }`}
          >
            {success ? <Check className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            {success || error}
          </motion.div>
        )}

        {/* Profile Tab */}
        {activeTab === "profile" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Wallet Connection</h2>
              
              {address ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#4f7cff] to-[#00d4ff] flex items-center justify-center">
                      <Wallet className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <div className="text-white font-medium">Connected Wallet</div>
                      <div className="text-[#707090] text-sm flex items-center gap-2">
                        {shortenAddress(address)}
                        <button
                          onClick={() => handleCopy(address)}
                          className="text-[#4f7cff] hover:text-[#00d4ff]"
                        >
                          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4 pt-4 border-t border-[#4f7cff]/10">
                    <div className="flex-1">
                      <div className="text-[#707090] text-sm">User Role</div>
                      <div className="text-white capitalize">{user?.role || "User"}</div>
                    </div>
                    <a
                      href={`https://polygonscan.com/address/${address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-ghost text-sm"
                    >
                      <ExternalLink className="w-4 h-4" /> View on Explorer
                    </a>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-[#707090] mb-4">No wallet connected</p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Notifications Tab */}
        {activeTab === "notifications" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Notification Preferences</h2>

              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-[#4f7cff]" />
                </div>
              ) : (
                <div className="space-y-4">
                  <label className="flex items-center justify-between p-4 bg-[#0a0a12] rounded-lg">
                    <div>
                      <div className="text-white">Workflow Notifications</div>
                      <div className="text-[#707090] text-sm">Get notified when workflows complete</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifPrefs.notifyOnWorkflowComplete}
                      onChange={(e) => setNotifPrefs({ ...notifPrefs, notifyOnWorkflowComplete: e.target.checked })}
                      className="w-5 h-5 accent-[#4f7cff]"
                    />
                  </label>

                  <label className="flex items-center justify-between p-4 bg-[#0a0a12] rounded-lg">
                    <div>
                      <div className="text-white">Low Credits Alert</div>
                      <div className="text-[#707090] text-sm">
                        Alert when balance falls below {notifPrefs.lowCreditsThreshold} NCR
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={notifPrefs.notifyOnLowCredits}
                      onChange={(e) => setNotifPrefs({ ...notifPrefs, notifyOnLowCredits: e.target.checked })}
                      className="w-5 h-5 accent-[#4f7cff]"
                    />
                  </label>

                  {notifPrefs.notifyOnLowCredits && (
                    <div className="p-4 bg-[#0a0a12] rounded-lg">
                      <label className="text-white text-sm">Low Credits Threshold</label>
                      <input
                        type="number"
                        value={notifPrefs.lowCreditsThreshold}
                        onChange={(e) => setNotifPrefs({ ...notifPrefs, lowCreditsThreshold: parseInt(e.target.value) || 100 })}
                        className="mt-2 w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-2 text-white"
                      />
                    </div>
                  )}

                  <div className="p-4 bg-[#0a0a12] rounded-lg">
                    <label className="text-white text-sm">Discord Webhook (optional)</label>
                    <input
                      type="url"
                      value={notifPrefs.discordWebhook || ""}
                      onChange={(e) => setNotifPrefs({ ...notifPrefs, discordWebhook: e.target.value || null })}
                      placeholder="https://discord.com/api/webhooks/..."
                      className="mt-2 w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-2 text-white placeholder-[#505060]"
                    />
                    <p className="text-[#505060] text-xs mt-1">Get notifications in your Discord server</p>
                  </div>

                  <button
                    onClick={saveNotificationPrefs}
                    disabled={saving}
                    className="btn-neural w-full justify-center"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Preferences
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Webhooks Tab */}
        {activeTab === "webhooks" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Webhook Endpoints</h2>
              <p className="text-[#707090] text-sm mb-6">
                Receive real-time notifications at your custom endpoints
              </p>

              {/* Add New Webhook */}
              <div className="p-4 bg-[#0a0a12] rounded-lg mb-6">
                <div className="space-y-3">
                  <input
                    type="url"
                    value={newWebhookUrl}
                    onChange={(e) => setNewWebhookUrl(e.target.value)}
                    placeholder="https://your-server.com/webhook"
                    className="w-full bg-[#0f0f18] border border-[#4f7cff]/20 rounded-lg px-4 py-2 text-white placeholder-[#505060]"
                  />
                  
                  <div className="flex flex-wrap gap-2">
                    {eventOptions.map((event) => (
                      <label
                        key={event.id}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-all ${
                          selectedEvents.includes(event.id)
                            ? "bg-[#4f7cff] text-white"
                            : "bg-[#0f0f18] text-[#707090] hover:text-white"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedEvents.includes(event.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedEvents([...selectedEvents, event.id]);
                            } else {
                              setSelectedEvents(selectedEvents.filter(id => id !== event.id));
                            }
                          }}
                          className="hidden"
                        />
                        {event.label}
                      </label>
                    ))}
                  </div>

                  <button
                    onClick={addWebhook}
                    disabled={!newWebhookUrl.trim() || saving}
                    className="btn-neural w-full justify-center"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add Webhook
                  </button>
                </div>
              </div>

              {/* Existing Webhooks */}
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-[#4f7cff]" />
                </div>
              ) : webhooks.length === 0 ? (
                <div className="text-center py-8 text-[#707090]">
                  <Link2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No webhooks configured</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {webhooks.map((webhook) => (
                    <div
                      key={webhook.id}
                      className="flex items-center justify-between p-4 bg-[#0a0a12] rounded-lg"
                    >
                      <div className="flex-1 min-w-0 mr-4">
                        <div className="text-white text-sm truncate">{webhook.url}</div>
                        <div className="text-[#505060] text-xs mt-1">
                          Events: {(webhook.events || []).join(", ")}
                        </div>
                        {webhook.last_triggered_at && (
                          <div className="text-[#505060] text-xs mt-1">
                            Last triggered: {new Date(webhook.last_triggered_at).toLocaleString()}
                            {webhook.last_status && (
                              <span className={webhook.last_status === 200 ? "text-[#39ff8e]" : "text-red-400"}>
                                {" "}(Status: {webhook.last_status})
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => testWebhook(webhook.id)}
                          className="p-2 text-[#707090] hover:text-[#4f7cff] hover:bg-[#4f7cff]/10 rounded-lg"
                          title="Test webhook"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteWebhook(webhook.id)}
                          className="p-2 text-[#707090] hover:text-red-400 hover:bg-red-500/10 rounded-lg"
                          title="Delete webhook"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Security Tab */}
        {activeTab === "security" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-[#0f0f18] border border-[#4f7cff]/10 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Security</h2>
              
              <div className="space-y-4">
                <div className="p-4 bg-[#0a0a12] rounded-lg">
                  <div className="flex items-center gap-3 mb-2">
                    <Shield className="w-5 h-5 text-[#39ff8e]" />
                    <span className="text-white font-medium">Wallet-Based Authentication</span>
                  </div>
                  <p className="text-[#707090] text-sm">
                    Your account is secured by your wallet's private key. No password needed.
                  </p>
                </div>

                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <h3 className="text-red-400 font-medium mb-2">Danger Zone</h3>
                  <p className="text-[#909098] text-sm mb-4">
                    Disconnect your wallet to log out of Nooterra.
                  </p>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition-all"
                  >
                    <LogOut className="w-4 h-4" />
                    Disconnect Wallet & Logout
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
