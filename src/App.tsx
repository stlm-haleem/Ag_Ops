import { Route, Routes } from 'react-router-dom'
import Layout, { Placeholder } from './components/Layout'
import CurrencyOverview from './pages/CurrencyOverview'
import DataSources from './pages/DataSources'
import Executive from './pages/Executive'
import GatewayPage from './pages/GatewayPage'
import SettingsPage from './pages/Settings'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Executive />} />
        <Route path="/operations/all" element={<Placeholder title="All Agents" />} />
        <Route path="/operations/low" element={<Placeholder title="Low Balance" />} />
        <Route path="/operations/high" element={<Placeholder title="High Balance" />} />
        <Route path="/operations/alerts" element={<Placeholder title="Alerts" />} />
        <Route path="/currency/bdt" element={<CurrencyOverview currency="BDT" />} />
        <Route path="/currency/bdt/ssg" element={<GatewayPage key="ssg" currency="BDT" gateway="SSG" />} />
        <Route path="/currency/bdt/mcg" element={<GatewayPage key="mcg" currency="BDT" gateway="MCG" />} />
        <Route path="/currency/bdt/local-bank" element={<Placeholder title="BDT · Local Bank" />} />
        <Route path="/currency/pkr" element={<Placeholder title="PKR Overview" />} />
        <Route path="/currency/pkr/ssg" element={<Placeholder title="PKR · SSG" />} />
        <Route path="/currency/pkr/bangkok-pay" element={<Placeholder title="PKR · Bangkok-Pay" />} />
        <Route path="/currency/pkr/local-bank" element={<Placeholder title="PKR · Local Bank" />} />
        <Route path="/currency/inr" element={<Placeholder title="INR" note="INR is not live yet." />} />
        <Route path="/reports" element={<Placeholder title="Reports" />} />
        <Route path="/admin/data-sources" element={<DataSources />} />
        <Route path="/admin/settings" element={<SettingsPage />} />
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Routes>
    </Layout>
  )
}
