import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Users,
  UserCheck,
  Calendar,
  CalendarSync,
  Stethoscope,
  Receipt,
  BarChart3,
  ShieldCheck,
  Settings,
  Search,
  Bell,
  ChevronDown,
  UserPlus,
  PlusCircle,
  FileText,
  CreditCard,
  FileSpreadsheet,
  ArrowUpRight,
  TrendingUp,
  Clock,
  MoreVertical,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ExternalLink,
  ShieldAlert,
  ChevronRight
} from 'lucide-react';
import { db, isConfigured } from './firebase';
import { collection, query, getDocs, onSnapshot, limit, orderBy } from 'firebase/firestore';

export default function App() {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');

  // Live Firebase or Demo stats
  const [stats, setStats] = useState({
    activeNurses: 12,
    activeCustomers: 28,
    todayAppointments: 16,
    upcomingShifts: 8,
    outstandingPayments: 2450.00,
  });

  const [appointments, setAppointments] = useState([
    { id: '1', time: '09:00 AM', customer: 'Sarah Williams', service: 'Personal Care', nurse: 'T. Clarke', status: 'In Progress' },
    { id: '2', time: '10:30 AM', customer: 'James Brown', service: 'Medication Reminder', nurse: 'L. Johnson', status: 'Scheduled' },
    { id: '3', time: '12:00 PM', customer: 'Maria Lopez', service: 'Wound Care', nurse: 'S. Davis', status: 'Scheduled' },
    { id: '4', time: '01:30 PM', customer: 'Patricia Allen', service: 'Companionship', nurse: 'R. Edwards', status: 'Scheduled' },
    { id: '5', time: '03:00 PM', customer: 'Robert Taylor', service: 'Personal Care', nurse: 'T. Clarke', status: 'Scheduled' },
    { id: '6', time: '04:30 PM', customer: 'Linda Martin', service: 'Light Housekeeping', nurse: 'N. Scott', status: 'Scheduled' },
  ]);

  const [activities, setActivities] = useState([
    { id: '1', type: 'nurse', title: 'New nurse registration', desc: 'Ashley Thomas has been added to the system.', time: '10:15 AM', iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600' },
    { id: '2', type: 'payment', title: 'Payment received', desc: '$150.00 from Maria Lopez.', time: '09:48 AM', iconBg: 'bg-green-100', iconColor: 'text-green-600' },
    { id: '3', type: 'shift', title: 'Shift request', desc: 'Jamal Carter requested a shift change.', time: '09:32 AM', iconBg: 'bg-blue-100', iconColor: 'text-blue-600' },
    { id: '4', type: 'customer', title: 'New customer registration', desc: 'David Wilson has been added as a customer.', time: '08:50 AM', iconBg: 'bg-purple-100', iconColor: 'text-purple-600' },
    { id: '5', type: 'invoice', title: 'Invoice overdue', desc: 'Invoice #INV-1042 is 3 days past due.', time: '08:20 AM', iconBg: 'bg-red-100', iconColor: 'text-red-600' },
  ]);

  // Update real-time date clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
      setCurrentTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Listen for real Firestore data if credentials exist
  useEffect(() => {
    if (!isConfigured || !db) return;

    try {
      // Sync appointments
      const apptQuery = query(collection(db, 'appointments'), limit(10));
      const unsubscribeAppt = onSnapshot(apptQuery, (snapshot) => {
        if (!snapshot.empty) {
          const list = snapshot.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              time: data.time || '10:00 AM',
              customer: data.patientName || data.userName || data.clientName || 'Patient',
              service: data.serviceName || data.service || 'Nursing Care',
              nurse: data.assignedNurseName || data.nurseName || 'Unassigned',
              status: data.status || 'Scheduled',
            };
          });
          setAppointments(list);
          setStats((prev) => ({ ...prev, todayAppointments: snapshot.size }));
        }
      });

      // Sync nurses count
      const nurseQuery = query(collection(db, 'users'));
      const unsubscribeUsers = onSnapshot(nurseQuery, (snapshot) => {
        if (!snapshot.empty) {
          let nurseCount = 0;
          let customerCount = 0;
          snapshot.docs.forEach((d) => {
            const u = d.data();
            if (u.role === 'nurse') nurseCount++;
            if (u.role === 'customer' || u.role === 'patient') customerCount++;
          });
          if (nurseCount > 0) setStats((prev) => ({ ...prev, activeNurses: nurseCount, activeCustomers: customerCount || prev.activeCustomers }));
        }
      });

      return () => {
        unsubscribeAppt();
        unsubscribeUsers();
      };
    } catch (err) {
      console.warn('Firestore live sync error:', err);
    }
  }, []);

  const navItems = [
    { id: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'Nurses', label: 'Nurses', icon: UserCheck },
    { id: 'Customers', label: 'Customers', icon: Users },
    { id: 'Appointments', label: 'Appointments', icon: Calendar },
    { id: 'Shifts', label: 'Shifts & Coverage', icon: CalendarSync },
    { id: 'Services', label: 'Services', icon: Stethoscope },
    { id: 'Invoices', label: 'Invoices & Payments', icon: Receipt },
    { id: 'Reports', label: 'Reports', icon: BarChart3 },
    { id: 'Users', label: 'Users & Roles', icon: ShieldCheck },
    { id: 'Settings', label: 'Settings', icon: Settings },
  ];

  const filteredAppointments = appointments.filter(
    (a) =>
      a.customer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.service.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.nurse.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#F4F7FB' }}>
      {/* ================= LEFT SIDEBAR ================= */}
      <aside
        style={{
          width: '260px',
          backgroundColor: '#0A2B49',
          color: '#FFFFFF',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          boxShadow: '4px 0 20px rgba(0,0,0,0.06)',
          zIndex: 20,
        }}
      >
        {/* Brand Header */}
        <div style={{ padding: '24px 20px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #36A6E0 0%, #137C94 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(54,166,224,0.3)',
            }}
          >
            <Stethoscope size={22} color="#FFFFFF" />
          </div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.3px', color: '#FFFFFF' }}>876Nurses</div>
            <div style={{ fontSize: '11px', color: '#7DD6F0', fontWeight: '600', letterSpacing: '0.4px', textTransform: 'uppercase' }}>CARE Nursing Services</div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto' }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  backgroundColor: isActive ? '#36A6E0' : 'transparent',
                  color: isActive ? '#FFFFFF' : '#94A3B8',
                  fontSize: '14px',
                  fontWeight: isActive ? '700' : '500',
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)';
                    e.currentTarget.style.color = '#FFFFFF';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = '#94A3B8';
                  }
                }}
              >
                <Icon size={19} color={isActive ? '#FFFFFF' : '#7DD6F0'} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer Tagline Card */}
        <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div
            style={{
              padding: '16px',
              borderRadius: '12px',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
              border: '1px solid rgba(255,255,255,0.08)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#FFFFFF', marginBottom: '4px' }}>Better Care.</div>
            <div style={{ fontSize: '12px', color: '#7DD6F0', fontWeight: '600' }}>Stronger Communities.</div>
            <div style={{ fontSize: '10px', color: '#64748B', marginTop: '8px' }}>CARE Nursing Services Ltd</div>
          </div>
        </div>
      </aside>

      {/* ================= MAIN CONTENT AREA ================= */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* TOP BAR */}
        <header
          style={{
            height: '72px',
            backgroundColor: '#FFFFFF',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 32px',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          {/* Search Input */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              backgroundColor: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '24px',
              padding: '8px 18px',
              width: '420px',
            }}
          >
            <Search size={18} color="#94A3B8" />
            <input
              type="text"
              placeholder="Search customers, nurses, appointments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: '13.5px',
                width: '100%',
                color: '#1E293B',
              }}
            />
          </div>

          {/* Right Header: Notification + Admin Profile */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            {/* Notifications */}
            <div style={{ position: 'relative', cursor: 'pointer' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  backgroundColor: '#F1F5F9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Bell size={19} color="#475569" />
              </div>
              <span
                style={{
                  position: 'absolute',
                  top: '-2px',
                  right: '-2px',
                  backgroundColor: '#EF4444',
                  color: '#FFFFFF',
                  fontSize: '10px',
                  fontWeight: '800',
                  borderRadius: '10px',
                  width: '18px',
                  height: '18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid #FFFFFF',
                }}
              >
                3
              </span>
            </div>

            {/* Admin User Profile */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #0A2B49 0%, #36A6E0 100%)',
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: '800',
                  fontSize: '15px',
                  boxShadow: '0 2px 8px rgba(10,43,73,0.15)',
                }}
              >
                KM
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#0F172A', lineHeight: 1.2 }}>Kadian Morris</div>
                <div style={{ fontSize: '11.5px', color: '#64748B', fontWeight: '500' }}>Administrator</div>
              </div>
              <ChevronDown size={16} color="#94A3B8" />
            </div>
          </div>
        </header>

        {/* DASHBOARD BODY */}
        <main style={{ flex: 1, padding: '28px 32px', overflowY: 'auto' }}>
          {/* Welcome Banner */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div>
              <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#0F172A', marginBottom: '4px' }}>Good Morning, Kadian</h1>
              <p style={{ fontSize: '14px', color: '#64748B' }}>Here's what's happening with your CARE Nursing Services today.</p>
            </div>
            {/* Live Clock Card */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                backgroundColor: '#FFFFFF',
                padding: '8px 16px',
                borderRadius: '12px',
                border: '1px solid #E2E8F0',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#475569', fontSize: '13px', fontWeight: '600' }}>
                <Calendar size={16} color="#36A6E0" />
                <span>{currentDate || 'Today'}</span>
              </div>
              <div style={{ width: '1px', height: '18px', backgroundColor: '#E2E8F0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#0F172A', fontSize: '13px', fontWeight: '800' }}>
                <Clock size={16} color="#137C94" />
                <span>{currentTime || '10:00 AM'}</span>
              </div>
            </div>
          </div>

          {/* ================= 5 KPI SUMMARY CARDS ================= */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '16px',
              marginBottom: '28px',
            }}
          >
            {/* Card 1: Active Nurses */}
            <div
              style={{
                backgroundColor: '#EBF6FC',
                border: '1px solid #BAE0F5',
                borderRadius: '16px',
                padding: '20px',
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    backgroundColor: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 6px rgba(54,166,224,0.15)',
                  }}
                >
                  <UserCheck size={22} color="#0A2B49" />
                </div>
                <div>
                  <div style={{ fontSize: '12.5px', color: '#475569', fontWeight: '600' }}>Active Nurses</div>
                  <div style={{ fontSize: '26px', fontWeight: '800', color: '#0A2B49', lineHeight: 1.1 }}>{stats.activeNurses}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', color: '#0E9F6E', fontWeight: '700' }}>
                <ArrowUpRight size={14} />
                <span>2 new this week</span>
              </div>
            </div>

            {/* Card 2: Active Customers */}
            <div
              style={{
                backgroundColor: '#E8F8F0',
                border: '1px solid #BCF0DA',
                borderRadius: '16px',
                padding: '20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    backgroundColor: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 6px rgba(14,159,110,0.15)',
                  }}
                >
                  <Users size={22} color="#0E9F6E" />
                </div>
                <div>
                  <div style={{ fontSize: '12.5px', color: '#475569', fontWeight: '600' }}>Active Customers</div>
                  <div style={{ fontSize: '26px', fontWeight: '800', color: '#0F172A', lineHeight: 1.1 }}>{stats.activeCustomers}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', color: '#0E9F6E', fontWeight: '700' }}>
                <ArrowUpRight size={14} />
                <span>3 new this week</span>
              </div>
            </div>

            {/* Card 3: Today's Appointments */}
            <div
              style={{
                backgroundColor: '#F3E8FF',
                border: '1px solid #E1C2FF',
                borderRadius: '16px',
                padding: '20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    backgroundColor: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 6px rgba(144,97,249,0.15)',
                  }}
                >
                  <Calendar size={22} color="#9061F9" />
                </div>
                <div>
                  <div style={{ fontSize: '12.5px', color: '#475569', fontWeight: '600' }}>Today's Appts</div>
                  <div style={{ fontSize: '26px', fontWeight: '800', color: '#0F172A', lineHeight: 1.1 }}>{stats.todayAppointments}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', color: '#7E3AF2', fontWeight: '700' }}>
                <ArrowUpRight size={14} />
                <span>4 scheduled</span>
              </div>
            </div>

            {/* Card 4: Upcoming Shifts */}
            <div
              style={{
                backgroundColor: '#FEF3C7',
                border: '1px solid #FDE68A',
                borderRadius: '16px',
                padding: '20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    backgroundColor: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 6px rgba(217,119,6,0.15)',
                  }}
                >
                  <Clock size={22} color="#D97706" />
                </div>
                <div>
                  <div style={{ fontSize: '12.5px', color: '#475569', fontWeight: '600' }}>Upcoming Shifts</div>
                  <div style={{ fontSize: '26px', fontWeight: '800', color: '#0F172A', lineHeight: 1.1 }}>{stats.upcomingShifts}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', color: '#D97706', fontWeight: '700' }}>
                <ArrowUpRight size={14} />
                <span>1 coverage request</span>
              </div>
            </div>

            {/* Card 5: Outstanding Payments */}
            <div
              style={{
                backgroundColor: '#FDE8E8',
                border: '1px solid #F8B4B4',
                borderRadius: '16px',
                padding: '20px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    backgroundColor: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 6px rgba(224,36,36,0.15)',
                  }}
                >
                  <Receipt size={22} color="#E02424" />
                </div>
                <div>
                  <div style={{ fontSize: '12.5px', color: '#475569', fontWeight: '600' }}>Outstanding</div>
                  <div style={{ fontSize: '22px', fontWeight: '800', color: '#0F172A', lineHeight: 1.1 }}>${stats.outstandingPayments.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', color: '#E02424', fontWeight: '700' }}>
                <ArrowUpRight size={14} />
                <span>2 pending invoices</span>
              </div>
            </div>
          </div>

          {/* ================= MIDDLE ROW: APPOINTMENTS & RECENT ACTIVITY ================= */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px', marginBottom: '28px' }}>
            {/* UPCOMING APPOINTMENTS TABLE */}
            <div
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: '16px',
                padding: '24px',
                border: '1px solid #E2E8F0',
                boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: '#EBF6FC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Calendar size={18} color="#36A6E0" />
                  </div>
                  <h2 style={{ fontSize: '16px', fontWeight: '800', color: '#0F172A' }}>Upcoming Appointments</h2>
                </div>
                <button style={{ fontSize: '13px', color: '#36A6E0', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  View All &rarr;
                </button>
              </div>

              {/* Table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1.5px solid #F1F5F9', color: '#64748B', textAlign: 'left', fontWeight: '600' }}>
                      <th style={{ padding: '10px 8px' }}>Time</th>
                      <th style={{ padding: '10px 8px' }}>Customer</th>
                      <th style={{ padding: '10px 8px' }}>Service</th>
                      <th style={{ padding: '10px 8px' }}>Nurse</th>
                      <th style={{ padding: '10px 8px' }}>Status</th>
                      <th style={{ padding: '10px 8px', width: '30px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAppointments.map((appt) => (
                      <tr key={appt.id} style={{ borderBottom: '1px solid #F8FAFC' }}>
                        <td style={{ padding: '12px 8px', fontWeight: '600', color: '#0F172A' }}>{appt.time}</td>
                        <td style={{ padding: '12px 8px', fontWeight: '700', color: '#1E293B' }}>{appt.customer}</td>
                        <td style={{ padding: '12px 8px', color: '#475569' }}>{appt.service}</td>
                        <td style={{ padding: '12px 8px', color: '#0A2B49', fontWeight: '600' }}>{appt.nurse}</td>
                        <td style={{ padding: '12px 8px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 10px',
                              borderRadius: '20px',
                              fontSize: '11px',
                              fontWeight: '700',
                              backgroundColor: appt.status === 'In Progress' ? '#E1EFFE' : '#E8F8F0',
                              color: appt.status === 'In Progress' ? '#1C64F2' : '#0E9F6E',
                            }}
                          >
                            {appt.status}
                          </span>
                        </td>
                        <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                          <button style={{ color: '#94A3B8' }}>
                            <MoreVertical size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RECENT ACTIVITY FEED */}
            <div
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: '16px',
                padding: '24px',
                border: '1px solid #E2E8F0',
                boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Bell size={18} color="#D97706" />
                  </div>
                  <h2 style={{ fontSize: '16px', fontWeight: '800', color: '#0F172A' }}>Recent Activity</h2>
                </div>
                <button style={{ fontSize: '13px', color: '#36A6E0', fontWeight: '700' }}>View All &rarr;</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {activities.map((act) => (
                  <div key={act.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        backgroundColor:
                          act.type === 'nurse'
                            ? '#E8F8F0'
                            : act.type === 'payment'
                            ? '#DEF7EC'
                            : act.type === 'shift'
                            ? '#E1EFFE'
                            : act.type === 'customer'
                            ? '#F3E8FF'
                            : '#FDE8E8',
                        color:
                          act.type === 'nurse'
                            ? '#0E9F6E'
                            : act.type === 'payment'
                            ? '#0E9F6E'
                            : act.type === 'shift'
                            ? '#1C64F2'
                            : act.type === 'customer'
                            ? '#9061F9'
                            : '#E02424',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {act.type === 'nurse' && <UserPlus size={18} />}
                      {act.type === 'payment' && <Receipt size={18} />}
                      {act.type === 'shift' && <CalendarSync size={18} />}
                      {act.type === 'customer' && <Users size={18} />}
                      {act.type === 'invoice' && <AlertCircle size={18} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#1E293B' }}>{act.title}</div>
                        <span style={{ fontSize: '11px', color: '#94A3B8' }}>{act.time}</span>
                      </div>
                      <p style={{ fontSize: '12px', color: '#64748B', margin: '2px 0 0', lineHeight: 1.4 }}>{act.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ================= BOTTOM ROW: REVENUE OVERVIEW & QUICK ACTIONS ================= */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
            {/* REVENUE OVERVIEW CARD WITH VISUAL BARS */}
            <div
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: '16px',
                padding: '24px',
                border: '1px solid #E2E8F0',
                boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: '#E1EFFE', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <BarChart3 size={18} color="#1C64F2" />
                  </div>
                  <h2 style={{ fontSize: '16px', fontWeight: '800', color: '#0F172A' }}>Revenue Overview</h2>
                </div>
                {/* Date Dropdown */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#F8FAFC', padding: '6px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '12px', fontWeight: '600', color: '#475569' }}>
                  <span>Apr 1, 2025 – Apr 29, 2025</span>
                  <ChevronDown size={14} />
                </div>
              </div>

              {/* Chart & Stat Split */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '24px', alignItems: 'center' }}>
                {/* Mock Visual Bar Chart */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '140px', borderBottom: '1px solid #E2E8F0', paddingBottom: '8px' }}>
                    {[
                      { label: 'Apr 1', h1: 35, h2: 45 },
                      { label: 'Apr 7', h1: 50, h2: 60 },
                      { label: 'Apr 14', h1: 65, h2: 70 },
                      { label: 'Apr 21', h1: 80, h2: 75 },
                      { label: 'Apr 28', h1: 95, h2: 100 },
                    ].map((bar, i) => (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', width: '100%', height: '100%', justifyContent: 'center' }}>
                          <div style={{ width: '40%', height: `${bar.h1}%`, backgroundColor: '#BAE0F5', borderRadius: '4px 4px 0 0' }} />
                          <div style={{ width: '40%', height: `${bar.h2}%`, backgroundColor: '#36A6E0', borderRadius: '4px 4px 0 0' }} />
                        </div>
                        <span style={{ fontSize: '10px', color: '#94A3B8', fontWeight: '600' }}>{bar.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Revenue Metrics Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: '#64748B', fontWeight: '600' }}>Total Revenue</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '20px', fontWeight: '800', color: '#0F172A' }}>$24,680.00</span>
                      <span style={{ fontSize: '11.5px', color: '#0E9F6E', fontWeight: '700' }}>&uarr; 12%</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: '#64748B', fontWeight: '600' }}>Total Payments</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '20px', fontWeight: '800', color: '#0F172A' }}>$18,450.00</span>
                      <span style={{ fontSize: '11.5px', color: '#0E9F6E', fontWeight: '700' }}>&uarr; 10%</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: '#64748B', fontWeight: '600' }}>Outstanding Balance</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '20px', fontWeight: '800', color: '#0F172A' }}>$6,230.00</span>
                      <span style={{ fontSize: '11.5px', color: '#E02424', fontWeight: '700' }}>&uarr; 5%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* QUICK ACTIONS GRID */}
            <div
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: '16px',
                padding: '24px',
                border: '1px solid #E2E8F0',
                boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: '#F3E8FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Sparkles size={18} color="#9061F9" />
                </div>
                <h2 style={{ fontSize: '16px', fontWeight: '800', color: '#0F172A' }}>Quick Actions</h2>
              </div>

              {/* 6 Quick Action Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                {[
                  { label: 'Add New Nurse', icon: UserPlus, bg: '#F3E8FF', color: '#9061F9' },
                  { label: 'Add Customer', icon: Users, bg: '#E8F8F0', color: '#0E9F6E' },
                  { label: 'Book Appt', icon: Calendar, bg: '#E1EFFE', color: '#1C64F2' },
                  { label: 'Create Invoice', icon: FileText, bg: '#FEF3C7', color: '#D97706' },
                  { label: 'Process Payment', icon: CreditCard, bg: '#EBF6FC', color: '#137C94' },
                  { label: 'Generate Report', icon: FileSpreadsheet, bg: '#F3E8FF', color: '#7E3AF2' },
                ].map((action, idx) => {
                  const ActionIcon = action.icon;
                  return (
                    <button
                      key={idx}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        padding: '14px 8px',
                        borderRadius: '12px',
                        backgroundColor: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#FFFFFF';
                        e.currentTarget.style.borderColor = '#36A6E0';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(54,166,224,0.12)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#F8FAFC';
                        e.currentTarget.style.borderColor = '#E2E8F0';
                        e.currentTarget.style.transform = 'none';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div
                        style={{
                          width: '34px',
                          height: '34px',
                          borderRadius: '8px',
                          backgroundColor: action.bg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <ActionIcon size={18} color={action.color} />
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: '700', color: '#1E293B', textAlign: 'center' }}>
                        {action.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* PORTAL FOOTER BAR */}
          <footer
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: '32px',
              paddingTop: '16px',
              borderTop: '1px solid #E2E8F0',
              fontSize: '11.5px',
              color: '#94A3B8',
            }}
          >
            <div>CARE Nursing Services &nbsp;|&nbsp; 876Nurses &nbsp;|&nbsp; Administration Portal</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10B981' }}></span>
              <span style={{ color: '#475569', fontWeight: '600' }}>System Online</span>
              <span>&nbsp;•&nbsp; v1.0.0</span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
