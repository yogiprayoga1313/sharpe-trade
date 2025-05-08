require('dotenv').config();
const { ethers } = require('ethers');
const axios = require('axios');

// Initialize provider for Monad network
const provider = new ethers.JsonRpcProvider(process.env.MONAD_RPC_URL);

// Function to mask wallet address
function maskAddress(address) {
    if (!address) return '';
    return address.slice(0, 6) + '...' + address.slice(-4);
}

// Create wallet from private key
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
console.log('Wallet address:', maskAddress(wallet.address));

// Swap parameters
const SWAP_AMOUNT = "0.0012"; // Amount in MON
const SHERPA_ADDRESS = "0x04a9d9d4aea93f512a4c7b71993915004325ed38"; // SHERPA token address
const MON_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

// Generate nonce for authentication
function generateNonce() {
    return Math.random().toString(36).substring(2, 15);
}

// Create authentication message
function createAuthMessage(address, nonce) {
    return `app.sherpa.trade wants you to sign in with your Ethereum account:\n${address}\n\nSign in to Sherpa.\n\nURI: https://app.sherpa.trade\nVersion: 1\nChain ID: 10143\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}\nResources:\n- https://app.sherpa.trade`;
}

// Check WMON balance
async function checkWMONBalance() {
    try {
        const data = "0x70a08231000000000000000000000000" + wallet.address.slice(2);
        
        const response = await axios.post(`${process.env.SHERPA_API_URL}/rpc/monad`, {
            jsonrpc: "2.0",
            id: 1,
            method: "eth_call",
            params: [{
                data: data,
                to: SHERPA_ADDRESS
            }, "latest"]
        }, {
            headers: {
                'accept': '*/*',
                'content-type': 'application/json',
                'origin': 'https://app.sherpa.trade'
            }
        });

        const balance = BigInt(response.data.result);
        console.log('WMON Balance:', ethers.formatEther(balance));
        return balance;
    } catch (error) {
        console.error('Error checking WMON balance:', error.message);
        throw error;
    }
}

// Check MON balance
async function checkMONBalance() {
    try {
        const balance = await provider.getBalance(wallet.address);
        console.log('MON Balance:', ethers.formatEther(balance));
        return balance;
    } catch (error) {
        console.error('Error checking MON balance:', error.message);
        throw error;
    }
}

// Check notifications
async function checkNotifications(accessToken) {
    try {
        const response = await axios.get(`${process.env.HEDGEMONY_API_URL}/notifications`, {
            headers: {
                'accept': 'application/json',
                'authorization': `Bearer ${accessToken}`,
                'origin': 'https://app.sherpa.trade'
            }
        });

        if (response.data) {
            console.log('Notifications:', response.data);
            return response.data;
        }
        return null;
    } catch (error) {
        console.error('Error checking notifications:', error.message);
        return null;
    }
}

// Check token price
async function checkTokenPrice(tokenAddress) {
    try {
        const response = await axios.post(`${process.env.HEDGEMONY_API_URL}/graphql`, {
            query: `
                query GetTokenPrice($address: String!) {
                    getTokenPrices(address: $address) {
                        address
                        priceUsd
                        timestamp
                    }
                }
            `,
            variables: {
                address: tokenAddress
            }
        }, {
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                'origin': 'https://app.sherpa.trade'
            }
        });

        if (response.data && response.data.data && response.data.data.getTokenPrices) {
            const price = response.data.data.getTokenPrices[0];
            console.log(`Token price for ${tokenAddress}: $${price.priceUsd}`);
            return price.priceUsd;
        }
        return null;
    } catch (error) {
        console.error('Error checking token price:', error.message);
        return null;
    }
}

// Check trade history
async function checkTradeHistory(accessToken, txHash) {
    try {
        // Get trade history
        const response = await axios.get(`${process.env.HEDGEMONY_API_URL}/trade-history`, {
            headers: {
                'accept': 'application/json',
                'authorization': `Bearer ${accessToken}`,
                'origin': 'https://app.sherpa.trade'
            },
            params: {
                txHash: txHash.toLowerCase(),
                account: wallet.address,
                chainId: 10143
            }
        });

        if (response.data && response.data.length > 0) {
            const trade = response.data[0];
            console.log('Trade History Response:', trade);
            return trade;
        } else {
            console.log('Trade not found in history yet');
            return null;
        }
    } catch (error) {
        console.error('Error checking trade history:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
        return null;
    }
}

// Wait for trade status to change
async function waitForTradeStatus(accessToken, txHash) {
    let retries = 0;
    const maxRetries = 10;
    
    while (retries < maxRetries) {
        try {
            const tradeHistory = await checkTradeHistory(accessToken, txHash);
            if (tradeHistory && (tradeHistory.status === 'SUCCESS' || tradeHistory.status === 'CONFIRMED')) {
                console.log('Trade completed successfully!');
                return tradeHistory;
            }
            
            console.log(`Trade status: ${tradeHistory?.status || 'UNKNOWN'}, retry ${retries + 1}/${maxRetries}`);
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds between retries
            retries++;
        } catch (error) {
            console.error('Error waiting for trade status:', error.message);
            retries++;
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    
    throw new Error('Timeout waiting for trade status to change');
}

// Listen to credit updates
async function listenToCreditUpdates(accessToken) {
    return new Promise((resolve, reject) => {
        let creditUpdated = false;
        const timeout = setTimeout(() => {
            if (!creditUpdated) {
                reject(new Error('Timeout waiting for credit update'));
            }
        }, 60000); // Increase timeout to 60 seconds

        axios({
            method: 'get',
            url: `${process.env.HEDGEMONY_API_URL}/notifications`,
            responseType: 'stream',
            headers: {
                'accept': 'text/event-stream',
                'authorization': `Bearer ${accessToken}`,
                'origin': 'https://app.sherpa.trade'
            }
        }).then(response => {
            let buffer = '';
            
            response.data.on('data', chunk => {
                buffer += chunk.toString();
                
                // Process complete messages
                const messages = buffer.split('\n\n');
                buffer = messages.pop(); // Keep the last incomplete message in buffer
                
                for (const message of messages) {
                    if (message.trim()) {
                        try {
                            const lines = message.split('\n');
                            const dataLine = lines.find(line => line.startsWith('data:'));
                            
                            if (dataLine) {
                                const jsonStr = dataLine.substring(5).trim();
                                const data = JSON.parse(jsonStr);
                                
                                if (data.type === 'SwapExecutionTask' || data.type === 'CREDIT_UPDATE' || data.type === 'POINTS_UPDATE') {
                                    console.log(`Credit: ${data.increment}`);
                                    console.log(`Type Event: ${data.type}`);
                                    creditUpdated = true;
                                    clearTimeout(timeout);
                                    resolve(data);
                                }
                            }
                        } catch (error) {
                            console.error('Error parsing event:', error);
                        }
                    }
                }
            });

            response.data.on('error', error => {
                console.error('Stream error:', error);
                clearTimeout(timeout);
                reject(error);
            });

            response.data.on('end', () => {
                console.log('Stream ended');
                clearTimeout(timeout);
                if (!creditUpdated) {
                    reject(new Error('Stream ended without credit update'));
                }
            });
        }).catch(error => {
            console.error('Request error:', error);
            clearTimeout(timeout);
            reject(error);
        });
    });
}

// Check user points and profile
async function checkUserPoints(accessToken) {
    try {
        // Check user profile
        const userResponse = await axios.get(`${process.env.HEDGEMONY_API_URL}/users/me`, {
            headers: {
                'accept': 'application/json',
                'authorization': `Bearer ${accessToken}`,
                'origin': 'https://app.sherpa.trade'
            }
        });

        // Check tasks for credit activity
        const tasksResponse = await axios.get(`${process.env.HEDGEMONY_API_URL}/points/tasks?page=1&pageSize=8`, {
            headers: {
                'accept': 'application/json',
                'authorization': `Bearer ${accessToken}`,
                'origin': 'https://app.sherpa.trade'
            }
        });

        console.log('\nUser Profile:');
        console.log('Points:', userResponse.data.points);
        console.log('User Tier:', userResponse.data.userTier);
        console.log('Token Tier:', userResponse.data.tokenTierInfo?.userTokenTier);

        return {
            points: userResponse.data.points,
            userTier: userResponse.data.userTier,
            tokenTier: userResponse.data.tokenTierInfo?.userTokenTier,
            tasks: tasksResponse.data
        };
    } catch (error) {
        console.error('Error checking user points:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
        return null;
    }
}

// Auto login function
async function autoLogin() {
    try {
        const nonce = generateNonce();
        const message = createAuthMessage(wallet.address, nonce);
        
        // Sign message with private key
        const signature = await wallet.signMessage(message);

        // Authenticate with Hedgemony
        const authResponse = await axios.post(`${process.env.HEDGEMONY_API_URL}/auth`, {
            address: wallet.address,
            message,
            signature
        }, {
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                'origin': 'https://app.sherpa.trade'
            }
        });

        // Update session with access token
        const sessionResponse = await axios.post(`${process.env.SHERPA_API_URL}/auth/session`, {
            accessToken: authResponse.data.accessToken
        }, {
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                'cookie': 'selectWallet=OKX'
            }
        });

        console.log('Login berhasil!');
        console.log('Address:', maskAddress(wallet.address));
        console.log('Access Token:', maskAddress(authResponse.data.accessToken));
        
        return {
            address: wallet.address,
            accessToken: authResponse.data.accessToken,
            session: sessionResponse.data
        };
    } catch (error) {
        console.error('Error:', error.message);
        throw error;
    }
}

// Submit trade history
async function submitTradeHistory(accessToken, txHash, amount) {
    try {
        const response = await axios.post(`${process.env.HEDGEMONY_API_URL}/trade-history`, {
            txHash: txHash.toLowerCase(),
            account: wallet.address,
            chainId: 10143,
            date: new Date().toISOString(),
            tradeSource: "EOA",
            sellTokens: [{
                address: MON_ADDRESS,
                amount: amount.toString()
            }],
            buyTokens: [{
                address: SHERPA_ADDRESS,
                amount: amount.toString()
            }]
        }, {
            headers: {
                'accept': 'application/json',
                'content-type': 'application/json',
                'authorization': `Bearer ${accessToken}`,
                'origin': 'https://app.sherpa.trade'
            }
        });

        console.log('\x1b[32m%s\x1b[0m', `Trade History Submitted: ${txHash}`);
        return response.data;
    } catch (error) {
        console.error('Error submitting trade history:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
        return null;
    }
}

// Helper function to add delay
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to retry with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
    let retries = 0;
    let delay = initialDelay;

    while (retries < maxRetries) {
        try {
            return await fn();
        } catch (error) {
            if (error.response && error.response.status === 429) {
                retries++;
                if (retries === maxRetries) {
                    console.log('Rate limit reached. Waiting 60 seconds before continuing...');
                    await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 60 seconds
                    retries = 0; // Reset retries
                    continue; // Try again
                }
                console.log(`Rate limited. Retrying in ${delay/1000} seconds... (Attempt ${retries}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Exponential backoff
            } else {
                throw error;
            }
        }
    }
}

// Auto swap function
async function autoSwap(accessToken) {
    try {
        // Start listening to credit updates before swap
        console.log('Starting credit update listener...');
        const creditUpdatePromise = listenToCreditUpdates(accessToken);

        // Check initial points with retry
        console.log('Checking initial points...');
        const initialPoints = await retryWithBackoff(() => checkUserPoints(accessToken));
        
        // Amount in wei
        const amount = ethers.parseEther(SWAP_AMOUNT);
        
        // Prepare swap data with proper slippage
        const swapData = {
            chainId: 10143,
            inputTokens: [{
                address: MON_ADDRESS,
                amount: amount.toString()
            }],
            outputTokens: [{
                address: SHERPA_ADDRESS,
                percent: 100
            }],
            recipient: wallet.address,
            slippage: -1 // Set slippage to -1 for better execution
        };

        console.log(`\nSwapping ${SWAP_AMOUNT} MON to SHERPA...`);
        console.log('Slippage: -1%');

        // Get swap route with retry
        const swapResponse = await retryWithBackoff(() => 
            axios.post(`${process.env.HEDGEMONY_API_URL}/swap`, swapData, {
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json',
                    'authorization': `Bearer ${accessToken}`,
                    'origin': 'https://app.sherpa.trade'
                }
            })
        );

        if (!swapResponse.data || !swapResponse.data.multicallTx) {
            throw new Error('Invalid swap response: missing multicallTx data');
        }

        const { to, value, data } = swapResponse.data.multicallTx;

        // Execute the transaction
        console.log('Executing swap transaction...');
        const tx = {
            to: to,
            value: value,
            data: data,
            gasLimit: 500000,
            maxFeePerGas: ethers.parseUnits("100", "gwei"),
            maxPriorityFeePerGas: ethers.parseUnits("1.5", "gwei")
        };

        // Send transaction
        const transaction = await wallet.sendTransaction(tx);
        console.log('Transaction sent!');
        console.log('Transaction Hash:', maskAddress(transaction.hash));

        // Submit trade history immediately after transaction is sent
        console.log('\nSubmitting trade history...');
        await retryWithBackoff(() => submitTradeHistory(accessToken, transaction.hash, amount));

        // Wait for transaction to be mined with retry mechanism
        let receipt = null;
        let retries = 0;
        const maxRetries = 5;
        
        while (retries < maxRetries) {
            try {
                receipt = await provider.getTransactionReceipt(transaction.hash);
                if (receipt) {
                    console.log('Transaction confirmed in block:', receipt.blockNumber);
                    console.log('Status:', receipt.status === 1 ? 'Success' : 'Failed');
                    break;
                }
            } catch (error) {
                console.log(`Retry ${retries + 1}/${maxRetries} - Waiting for transaction...`);
            }
            
            retries++;
            await delay(5000);
        }
        
        if (!receipt) {
            console.log('Transaction hash:', transaction.hash);
            console.log('Note: Transaction is pending. Please check the status manually.');
        }

        // Add delay after transaction confirmation
        console.log('Waiting 10 seconds before checking balances...');
        await delay(10000);

        // Check new balances after swap
        console.log('\nChecking new balances...');
        await checkMONBalance();
        await checkTokenBalance(SHERPA_ADDRESS);

        // Wait for credit update
        console.log('\nWaiting for credit update...');
        try {
            const creditUpdate = await creditUpdatePromise;
            console.log(`Credit: ${creditUpdate.increment}`);
            console.log(`Type Event: ${creditUpdate.type}`);
        } catch (error) {
            console.log('No credit update received within timeout');
        }

        // Add delay before checking final points
        console.log('Waiting 5 seconds before checking final points...');
        await delay(5000);

        // Check final points and credit activity with retry
        console.log('\nChecking points and credit activity...');
        const finalPoints = await retryWithBackoff(() => checkUserPoints(accessToken));

        // Display points comparison
        if (initialPoints && finalPoints) {
            console.log('\n=== Points and Credit Activity ===');
            console.log('Initial Points:', initialPoints.points);
            console.log('Final Points:', finalPoints.points);
            console.log('Points Earned:', finalPoints.points - initialPoints.points);
            console.log('User Tier:', finalPoints.userTier);
            console.log('Token Tier:', finalPoints.tokenTier);
            
            // Display credit activity from tasks
            if (finalPoints.tasks && finalPoints.tasks.length > 0) {
                console.log('\nCredit Activity:');
                finalPoints.tasks.forEach(task => {
                    if (task.completed) {
                        console.log(`- ${task.name}: ${task.points} points`);
                    }
                });
            }
        }
        
        return {
            txHash: transaction.hash,
            receipt: receipt,
            points: {
                initial: initialPoints,
                final: finalPoints
            }
        };
    } catch (error) {
        console.error('Error during swap:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
        throw error;
    }
}

// Check token balance
async function checkTokenBalance(tokenAddress) {
    try {
        const data = "0x70a08231000000000000000000000000" + wallet.address.slice(2);
        
        const response = await axios.post(`${process.env.SHERPA_API_URL}/rpc/monad`, {
            jsonrpc: "2.0",
            id: 1,
            method: "eth_call",
            params: [{
                data: data,
                to: tokenAddress
            }, "latest"]
        }, {
            headers: {
                'accept': '*/*',
                'content-type': 'application/json',
                'origin': 'https://app.sherpa.trade'
            }
        });

        const balance = BigInt(response.data.result);
        console.log('Token Balance:', ethers.formatEther(balance));
        return balance;
    } catch (error) {
        console.error('Error checking token balance:', error.message);
        throw error;
    }
}

// Main function to run the process
async function main() {
    try {
        // Check initial balances
        console.log('Checking initial balances...');
        await checkMONBalance();
        await checkTokenBalance(SHERPA_ADDRESS);
        
        // Login first
        const loginResult = await autoLogin();
        
        // Track total MON swapped
        let totalMONSwapped = ethers.parseEther("0");
        const maxMONToSwap = ethers.parseEther("1"); // 1 MON limit
        
        // Perform swaps until reaching 1 MON
        let swapCount = 0;
        while (totalMONSwapped < maxMONToSwap) {
            try {
                swapCount++;
                console.log(`\n=== Swap ${swapCount} ===`);
                console.log(`Total MON swapped so far: ${ethers.formatEther(totalMONSwapped)} MON`);
                
                // Check if next swap would exceed 1 MON
                const nextSwapAmount = ethers.parseEther(SWAP_AMOUNT);
                if (totalMONSwapped + nextSwapAmount > maxMONToSwap) {
                    console.log('Reached 1 MON swap limit, stopping swaps...');
                    break;
                }
                
                const swapResult = await autoSwap(loginResult.accessToken);
                totalMONSwapped = totalMONSwapped + nextSwapAmount;
                
                // Add delay between swaps
                console.log('Waiting 20 seconds before next swap...');
                await new Promise(resolve => setTimeout(resolve, 20000)); // 20 seconds delay
            } catch (error) {
                if (error.response && error.response.status === 429) {
                    console.log('Rate limit reached. Waiting 60 seconds before continuing...');
                    await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 60 seconds
                    continue; // Try the same swap again
                }
                throw error; // Re-throw other errors
            }
        }

        console.log(`\nCompleted ${swapCount} swaps`);
        console.log(`Total MON swapped: ${ethers.formatEther(totalMONSwapped)} MON`);

        // After all swaps are done, wait 20 seconds before final swap
        console.log('\nWaiting 20 seconds before final SHERPA to MON swap...');
        await delay(20000);

        // After all swaps are done, swap all SHERPA back to MON
        console.log('\n=== Final Swap: SHERPA to MON ===');
        
        // Get SHERPA balance
        const sherpaBalance = await checkTokenBalance(SHERPA_ADDRESS);
        console.log(`Swapping ${ethers.formatEther(sherpaBalance)} SHERPA back to MON...`);

        // Prepare swap data for SHERPA to MON
        const reverseSwapData = {
            chainId: 10143,
            inputTokens: [{
                address: SHERPA_ADDRESS,
                amount: sherpaBalance.toString()
            }],
            outputTokens: [{
                address: MON_ADDRESS,
                percent: 100
            }],
            recipient: wallet.address,
            slippage: -1
        };

        // Get swap route for reverse swap
        const reverseSwapResponse = await retryWithBackoff(() => 
            axios.post(`${process.env.HEDGEMONY_API_URL}/swap`, reverseSwapData, {
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json',
                    'authorization': `Bearer ${loginResult.accessToken}`,
                    'origin': 'https://app.sherpa.trade'
                }
            })
        );

        if (!reverseSwapResponse.data || !reverseSwapResponse.data.multicallTx) {
            throw new Error('Invalid reverse swap response: missing multicallTx data');
        }

        const { to: reverseTo, value: reverseValue, data: reverseData } = reverseSwapResponse.data.multicallTx;

        // Execute the reverse transaction
        console.log('Executing SHERPA to MON swap transaction...');
        const reverseTx = {
            to: reverseTo,
            value: reverseValue,
            data: reverseData,
            gasLimit: 500000,
            maxFeePerGas: ethers.parseUnits("100", "gwei"),
            maxPriorityFeePerGas: ethers.parseUnits("1.5", "gwei")
        };

        // Send reverse transaction
        const reverseTransaction = await wallet.sendTransaction(reverseTx);
        console.log('Reverse transaction sent!');
        console.log('Transaction Hash:', maskAddress(reverseTransaction.hash));

        // Submit trade history for reverse swap
        console.log('\nSubmitting reverse trade history...');
        await retryWithBackoff(() => submitTradeHistory(loginResult.accessToken, reverseTransaction.hash, sherpaBalance));

        // Wait for reverse transaction to be mined
        let reverseReceipt = null;
        let retries = 0;
        const maxRetries = 5;
        
        while (retries < maxRetries) {
            try {
                reverseReceipt = await provider.getTransactionReceipt(reverseTransaction.hash);
                if (reverseReceipt) {
                    console.log('Reverse transaction confirmed in block:', reverseReceipt.blockNumber);
                    console.log('Status:', reverseReceipt.status === 1 ? 'Success' : 'Failed');
                    break;
                }
            } catch (error) {
                console.log(`Retry ${retries + 1}/${maxRetries} - Waiting for reverse transaction...`);
            }
            
            retries++;
            await delay(5000);
        }

        // Check final balances
        console.log('\nChecking final balances...');
        await checkMONBalance();
        await checkTokenBalance(SHERPA_ADDRESS);

    } catch (error) {
        console.error('Error in main process:', error.message);
        process.exit(1);
    }
}

// Run the main function
main(); 