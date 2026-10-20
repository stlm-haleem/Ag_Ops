import { Route, Routes } from 'react-router-dom'
import Layout, { Placeholder } from './components/Layout'
import CurrencyOverview from './pages/CurrencyOverview'
import DataSources from './pages/DataSources'
import Executive from './pages/Executive'
import GatewayPage from './pages/GatewayPage'
import LocalBankPage from './pages/LocalBankPage'
import BdtLocalBankPage from './pages/BdtLocalBankPage'
import SettingsPage from './pages/Settings'
import InrPage from './pages/InrPage'
import ReportsPage from './pages/Reports'
import { AllAgentsPage, OpsListPage } from './pages/Operations'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Executive />} />
        <Route path="/operations/all" element={<AllAgentsPage />} />
        <Route path="/operations/low" element={<OpsListPage mode="low" />} />
        <Route path="/operations/high" element={<OpsListPage mode="high" />} />
        <Route path="/operations/alerts" element={<OpsListPage mode="alerts" />} />
        <Route path="/currency/bdt" element={<CurrencyOverview currency="BDT" />} />
        <Route path="/currency/bdt/ssg" element={<GatewayPage key="ssg" currency="BDT" gateway="SSG" />} />
        <Route path="/currency/bdt/mcg" element={<GatewayPage key="mcg" currency="BDT" gateway="MCG" />} />
        <Route path="/currency/bdt/local-bank" element={<BdtLocalBankPage />} />
        <Route path="/currency/pkr" element={<CurrencyOverview currency="PKR" />} />
        <Route path="/currency/pkr/ssg" element={<GatewayPage key="pkr-ssg" currency="PKR" gateway="SSG" />} />
        <Route path="/currency/pkr/bangkok-pay" element={<GatewayPage key="pkr-bkk" currency="PKR" gateway="BKK" />} />
        <Route path="/currency/pkr/bkk" element={<GatewayPage key="pkr-bkk2" currency="PKR" gateway="BKK" />} />
        <Route path="/currency/pkr/local-bank" element={<LocalBankPage />} />
        <Route path="/currency/inr" element={<InrPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/admin/data-sources" element={<DataSources />} />
        <Route path="/admin/settings" element={<SettingsPage />} />
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Routes>
    </Layout>
  )
}
