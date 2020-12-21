import { ethers, Contract, BigNumber } from 'ethers'

import ContractStore from 'stores/ContractStore'
import PoolStore from 'stores/PoolStore'
import CoinStore from 'stores/CoinStore'
import { aprToApy } from 'utils/math'
import { pools } from 'constants/Pool'
import { displayCurrency } from 'utils/math'
import { sleep } from 'utils/utils'

import AccountStore from 'stores/AccountStore'
import YieldStore from 'stores/YieldStore'
import StakeStore from 'stores/StakeStore'
import addresses from 'constants/contractAddresses'
import usdtAbi from 'constants/mainnetAbi/usdt.json'
import usdcAbi from 'constants/mainnetAbi/cUsdc.json'
import daiAbi from 'constants/mainnetAbi/dai.json'
import ognAbi from 'constants/mainnetAbi/ogn.json'

export async function setupContracts(account, library, chainId) {
  // without an account logged in contracts are initilised with JsonRpcProvider and
  // can operate in a read-only mode
  const jsonRpcProvider = new ethers.providers.JsonRpcProvider(
    process.env.ETHEREUM_RPC_PROVIDER,
    { chainId: parseInt(process.env.ETHEREUM_RPC_CHAIN_ID) }
  )

  let provider = jsonRpcProvider

  let walletConnected = false

  // if web3 account signed in change the dapp's "general provider" with the user's web3 provider
  if (account && library) {
    walletConnected = true
    provider = library.getSigner(account)
  }

  const getContract = (address, abi, overrideProvider) => {
    return new ethers.Contract(
      address,
      abi,
      overrideProvider ? overrideProvider : provider
    )
  }

  let network
  try {
    network = require(`../../${chainId === 1 ? 'prod.' : ''}network.json`)
  } catch (e) {
    console.error('network.json file not present')
    // contract addresses not present no need to continue initialisation
    return
  }

  const contracts = {}
  for (const key in network.contracts) {
    // Use Proxy address if one exists
    const address = network.contracts[`${key}Proxy`]
      ? network.contracts[`${key}Proxy`].address
      : network.contracts[key].address

    contracts[key] = new ethers.Contract(
      address,
      network.contracts[key].abi,
      library ? library.getSigner(account) : null
    )
  }

  const ousdProxy = contracts['OUSDProxy']
  const vaultProxy = contracts['VaultProxy']
  const OGNStakingProxy = contracts['OGNStakingProxy']
  let liquidityRewardOUSD_USDTProxy,
    liquidityRewardOUSD_DAIProxy,
    liquidityRewardOUSD_USDCProxy

  if (process.env.ENABLE_LIQUIDITY_MINING === 'true') {
    liquidityRewardOUSD_USDTProxy = contracts['LiquidityRewardOUSD_USDTProxy']
    liquidityRewardOUSD_DAIProxy = contracts['LiquidityRewardOUSD_DAIProxy']
    liquidityRewardOUSD_USDCProxy = contracts['LiquidityRewardOUSD_USDCProxy']
  }

  let usdt,
    dai,
    tusd,
    usdc,
    ousd,
    vault,
    ogn,
    uniV2OusdUsdt,
    uniV2OusdUsdt_iErc20,
    uniV2OusdUsdt_iUniPair,
    uniV2OusdUsdc,
    uniV2OusdUsdc_iErc20,
    uniV2OusdUsdc_iUniPair,
    uniV2OusdDai,
    uniV2OusdDai_iErc20,
    uniV2OusdDai_iUniPair,
    liquidityOusdUsdt,
    liquidityOusdUsdc,
    liquidityOusdDai,
    ognStaking,
    ognStakingView

  let iVaultJson,
    liquidityRewardJson,
    iErc20Json,
    iUniPairJson,
    singleAssetStakingJson

  try {
    iVaultJson = require('../../abis/IVault.json')
    liquidityRewardJson = require('../../abis/LiquidityReward.json')
    iErc20Json = require('../../abis/IERC20.json')
    iUniPairJson = require('../../abis/IUniswapV2Pair.json')
    singleAssetStakingJson = require('../../abis/SingleAssetStaking.json')
  } catch (e) {
    console.error(`Can not find contract artifact file: `, e)
  }

  vault = getContract(vaultProxy.address, iVaultJson.abi)

  if (process.env.ENABLE_LIQUIDITY_MINING === 'true') {
    liquidityOusdUsdt = getContract(
      liquidityRewardOUSD_USDTProxy.address,
      liquidityRewardJson.abi
    )
    liquidityOusdUsdc = getContract(
      liquidityRewardOUSD_USDCProxy.address,
      liquidityRewardJson.abi
    )
    liquidityOusdDai = getContract(
      liquidityRewardOUSD_DAIProxy.address,
      liquidityRewardJson.abi
    )
  }

  ognStaking = getContract(OGNStakingProxy.address, singleAssetStakingJson.abi)
  ognStakingView = getContract(
    OGNStakingProxy.address,
    singleAssetStakingJson.abi,
    jsonRpcProvider
  )

  ousd = getContract(ousdProxy.address, network.contracts['OUSD'].abi)
  if (chainId == 31337) {
    usdt = contracts['MockUSDT']
    usdc = contracts['MockUSDC']
    dai = contracts['MockDAI']
    ogn = contracts['MockOGN']
    uniV2OusdUsdt = contracts['MockUniswapPairOUSD_USDT']
    uniV2OusdUsdc = contracts['MockUniswapPairOUSD_USDC']
    uniV2OusdDai = contracts['MockUniswapPairOUSD_DAI']
  } else {
    usdt = getContract(addresses.mainnet.USDT, usdtAbi.abi)
    usdc = getContract(addresses.mainnet.USDC, usdcAbi.abi)
    dai = getContract(addresses.mainnet.DAI, daiAbi.abi)
    ogn = getContract(addresses.mainnet.OGN, ognAbi.abi)

    if (process.env.ENABLE_LIQUIDITY_MINING === 'true') {
      uniV2OusdUsdt = null
      uniV2OusdUsdc = null
      uniV2OusdDai = null
      throw new Error(
        'uniV2OusdUsdt, uniV2OusdUsdc, uniV2OusdDai mainnet address is missing'
      )
    }
  }

  if (process.env.ENABLE_LIQUIDITY_MINING === 'true') {
    uniV2OusdUsdt_iErc20 = getContract(uniV2OusdUsdt.address, iErc20Json.abi)
    uniV2OusdUsdt_iUniPair = getContract(
      uniV2OusdUsdt.address,
      iUniPairJson.abi
    )

    uniV2OusdUsdc_iErc20 = getContract(uniV2OusdUsdc.address, iErc20Json.abi)
    uniV2OusdUsdc_iUniPair = getContract(
      uniV2OusdUsdc.address,
      iUniPairJson.abi
    )

    uniV2OusdDai_iErc20 = getContract(uniV2OusdDai.address, iErc20Json.abi)
    uniV2OusdDai_iUniPair = getContract(uniV2OusdDai.address, iUniPairJson.abi)
  }

  const fetchExchangeRates = async () => {
    const coins = ['dai', 'usdt', 'usdc']
    const ousdExchangeRates = {
      ...ContractStore.currentState.ousdExchangeRates,
    }
    const userActive = AccountStore.currentState.active === 'active'
    // do not fetch anything if the user is not active
    if (!userActive) {
      return
    }

    for (const coin of coins) {
      try {
        const priceBNMint = await vault.priceUSDMint(coin.toUpperCase())
        const priceBNRedeem = await vault.priceUSDRedeem(coin.toUpperCase())
        // Oracle returns with 18 decimal places
        // Also, convert that to USD/<coin> format
        const priceMint = Number(priceBNMint.toString()) / 1000000000000000000
        const priceRedeem =
          Number(priceBNRedeem.toString()) / 1000000000000000000
        ousdExchangeRates[coin] = {
          mint: priceMint,
          redeem: priceRedeem,
        }
      } catch (err) {
        console.error('Failed to fetch exchange rate', coin, err)
      }
    }

    ContractStore.update((store) => {
      store.ousdExchangeRates = { ...ousdExchangeRates }
    })
  }

  const fetchOgnStats = async () => {
    try {
      const response = await fetch(
        `${process.env.COINGECKO_API}/coins/origin-protocol`
      )
      if (response.ok) {
        const json = await response.json()
        const price = json.market_data.current_price.usd
        const circulating_supply = json.market_data.circulating_supply
        const market_cap = json.market_data.market_cap.usd

        CoinStore.update((s) => {
          s.ogn = {
            price,
            circulating_supply,
            market_cap,
          }
        })
      }
    } catch (err) {
      console.error('Failed to fetch APY', err)
    }
  }

  const fetchAPY = async () => {
    try {
      const response = await fetch(process.env.APR_ANALYTICS_ENDPOINT)
      if (response.ok) {
        const json = await response.json()
        const apy = aprToApy(parseFloat(json.apr), 7)
        ContractStore.update((s) => {
          s.apy = apy
        })
      }
    } catch (err) {
      console.error('Failed to fetch APY', err)
    }
  }

  const fetchCreditsPerToken = async () => {
    try {
      const response = await fetch(process.env.CREDITS_ANALYTICS_ENDPOINT)
      if (response.ok) {
        const json = await response.json()
        YieldStore.update((s) => {
          s.currentCreditsPerToken = parseFloat(json.current_credits_per_token)
          s.nextCreditsPerToken = parseFloat(json.next_credits_per_token)
        })
      }
    } catch (err) {
      console.error('Failed to fetch credits per token', err)
    }
  }

  const fetchCreditsBalance = async () => {
    try {
      if (!walletConnected) {
        return
      }
      const credits = await ousd.creditsBalanceOf(account)
      AccountStore.update((s) => {
        s.creditsBalanceOf = ethers.utils.formatUnits(credits[0], 18)
      })
    } catch (err) {
      console.error('Failed to fetch credits balance', err)
    }
  }

  const callWithDelay = () => {
    setTimeout(async () => {
      Promise.all([
        fetchExchangeRates(),
        fetchCreditsPerToken(),
        fetchCreditsBalance(),
        fetchAPY(),
        fetchOgnStats(),
      ])
    }, 2)
  }

  callWithDelay()

  if (window.fetchInterval) {
    clearInterval(fetchInterval)
  }

  if (walletConnected) {
    // execute in parallel and repeat in an interval
    window.fetchInterval = setInterval(() => {
      callWithDelay()
    }, 20000)
  }

  const contractsToExport = {
    usdt,
    dai,
    tusd,
    usdc,
    ousd,
    vault,
    ogn,
    uniV2OusdUsdt,
    uniV2OusdUsdt_iErc20,
    uniV2OusdUsdt_iUniPair,
    uniV2OusdUsdc,
    uniV2OusdUsdc_iErc20,
    uniV2OusdUsdc_iUniPair,
    uniV2OusdDai,
    uniV2OusdDai_iErc20,
    uniV2OusdDai_iUniPair,
    liquidityOusdUsdt,
    liquidityOusdUsdc,
    liquidityOusdDai,
    ognStaking,
    ognStakingView,
  }

  ContractStore.update((s) => {
    s.contracts = contractsToExport
  })

  if (process.env.ENABLE_LIQUIDITY_MINING === 'true') {
    await setupPools(account, contractsToExport)
  }

  await setupStakes(contractsToExport)

  return contractsToExport
}

const setupStakes = async (contractsToExport) => {
  try {
    const [durations, rates] = await Promise.all([
      await contractsToExport.ognStakingView.getAllDurations(),
      await contractsToExport.ognStakingView.getAllRates(),
    ])

    const adjustedRates = durations.map((duration, index) => {
      const days = duration / (24 * 60 * 60)

      if (
        process.env.NODE_ENV !== 'production' &&
        Math.floor(days) !== Math.ceil(days)
      ) {
        const largeInt = 100000000
        // On dev, one has a shorter duration
        return rates[index]
          .mul(BigNumber.from(365 * largeInt))
          .div(BigNumber.from(Math.round(days * largeInt)))
      } else {
        return rates[index].mul(BigNumber.from(365)).div(BigNumber.from(days))
      }
    })

    StakeStore.update((s) => {
      s.durations = durations
      s.rates = adjustedRates
    })
  } catch (e) {
    console.error('Can not read initial public stake data: ', e)
  }
}

const setupPools = async (account, contractsToExport) => {
  try {
    const enrichedPools = await Promise.all(
      pools.map(async (pool) => {
        let coin1Address, coin2Address, poolLpTokenBalance
        const poolContract = contractsToExport[pool.pool_contract_variable_name]
        const lpContract = contractsToExport[pool.lp_contract_variable_name]
        const lpContract_uniPair =
          contractsToExport[pool.lp_contract_variable_name_uniswapPair]
        const lpContract_ierc20 =
          contractsToExport[pool.lp_contract_variable_name_ierc20]

        if (pool.lp_contract_type === 'uniswap-v2') {
          ;[
            coin1Address,
            coin2Address,
            poolLpTokenBalance,
          ] = await Promise.all([
            await lpContract_uniPair.token0(),
            await lpContract_uniPair.token1(),
            await lpContract_ierc20.balanceOf(poolContract.address),
          ])
        }

        return {
          ...pool,
          coin_one: {
            ...pool.coin_one,
            contract_address: coin1Address,
          },
          coin_two: {
            ...pool.coin_two,
            contract_address: coin2Address,
          },
          pool_deposits: await displayCurrency(
            poolLpTokenBalance,
            lpContract_ierc20
          ),
          pool_contract_address: poolContract.address,
          contract: poolContract,
          lpContract: lpContract,
        }
      })
    )

    PoolStore.update((s) => {
      s.pools = enrichedPools
    })
  } catch (e) {
    console.error('Error thrown in setting up pools: ', e)
  }
}
