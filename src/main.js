import './style.css'
import { Interface, formatUnits, isHexString } from 'ethers'
import creditVaultAbi from '../CreditVault.json'

const iface = new Interface(creditVaultAbi)

const app = document.querySelector('#app')

app.innerHTML = `
  <main class="container">
    <h1>epochUpdate Calldata Decoder</h1>
    <p class="subtitle">Paste calldata for <code>epochUpdate</code>. Decoding updates live.</p>

    <label for="calldata">Calldata</label>
    <textarea id="calldata" placeholder="0x..."></textarea>

    <p id="status" class="status">Waiting for input.</p>
    <div id="results" class="results"></div>
  </main>
`

const calldataInput = document.querySelector('#calldata')
const status = document.querySelector('#status')
const results = document.querySelector('#results')

function normalizeHex(value) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`
}

function getNormalizedAmounts(raw) {
  return {
    oneE6: formatUnits(raw, 6),
    oneE8: formatUnits(raw, 8),
    oneE18: formatUnits(raw, 18),
  }
}

function renderRows(rows) {
  const content = rows
    .map((row) => {
      const normalized = getNormalizedAmounts(row.amount)
      return `
        <article class="row">
          <div><strong>Trader:</strong> <span class="mono">${row.trader}</span></div>
          <div><strong>Token:</strong> <span class="mono">${row.token}</span></div>
          <div><strong>Type:</strong> ${row.feeType}</div>
          <div><strong>Amount raw:</strong> <span class="mono">${row.amount.toString()}</span></div>
          <div><strong>1e6:</strong> <span class="mono">${normalized.oneE6}</span></div>
          <div><strong>1e8:</strong> <span class="mono">${normalized.oneE8}</span></div>
          <div><strong>1e18:</strong> <span class="mono">${normalized.oneE18}</span></div>
        </article>
      `
    })
    .join('')

  results.innerHTML = content
}

function decodeCalldata(input) {
  const data = normalizeHex(input)

  if (!data) {
    status.textContent = 'Waiting for input.'
    status.className = 'status'
    results.innerHTML = ''
    return
  }

  if (!isHexString(data)) {
    status.textContent = 'Invalid hex calldata.'
    status.className = 'status error'
    results.innerHTML = ''
    return
  }

  try {
    const decoded = iface.decodeFunctionData('epochUpdate', data)
    const accruedFees = decoded[0]
    const rows = []

    for (const feeByTrader of accruedFees) {
      for (const feeUpdate of feeByTrader.feeUpdates) {
        if (feeUpdate.fundingFee !== 0n) {
          rows.push({
            trader: feeByTrader.trader,
            token: feeUpdate.token,
            feeType: 'fundingFee',
            amount: feeUpdate.fundingFee,
          })
        }
        if (feeUpdate.reserveFee !== 0n) {
          rows.push({
            trader: feeByTrader.trader,
            token: feeUpdate.token,
            feeType: 'reserveFee',
            amount: feeUpdate.reserveFee,
          })
        }
      }
    }

    status.textContent = `Decoded ${rows.length} amount entries.`
    status.className = 'status success'

    if (rows.length === 0) {
      results.innerHTML = '<p>No fee updates found in calldata.</p>'
      return
    }

    renderRows(rows)
  } catch (error) {
    status.textContent = 'Unable to decode as epochUpdate calldata.'
    status.className = 'status error'
    results.innerHTML = ''
  }
}

calldataInput.addEventListener('input', (event) => {
  decodeCalldata(event.target.value)
})

calldataInput.addEventListener('focus', () => {
  calldataInput.select()
})
