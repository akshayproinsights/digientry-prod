"""
Test script to verify PostgreSQL advisory lock implementation for stock recalculation.

This script simulates concurrent stock recalculations to verify that:
1. Only one recalculation runs at a time per user
2. Locks are properly released
3. Different users can recalculate simultaneously
"""
import sys
import os
import time
import threading
import hashlib
import logging

# Add parent directory to path so we can import backend modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_database_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def test_advisory_lock(username: str, thread_id: int):
    """Test advisory lock acquisition and release"""
    db = get_database_client()
    
    # Generate lock ID (same logic as stock_routes.py)
    lock_id = int(hashlib.sha256(username.encode()).hexdigest()[:16], 16) % (2**63 - 1)
    
    logger.info(f"Thread {thread_id}: Attempting to acquire lock for {username} (lock_id={lock_id})")
    
    try:
        # Try to acquire lock
        start_time = time.time()
        lock_result = db.client.rpc('acquire_stock_lock', {'lock_id': lock_id}).execute()
        wait_time = time.time() - start_time
        
        logger.info(f"Thread {thread_id}: ✓ Lock acquired for {username} (waited {wait_time:.2f}s)")
        
        # Simulate work
        logger.info(f"Thread {thread_id}: Doing work for {username}...")
        time.sleep(2)  # Simulate stock recalculation
        
        logger.info(f"Thread {thread_id}: Work complete for {username}")
        
    except Exception as e:
        logger.error(f"Thread {thread_id}: Failed to acquire lock for {username}: {e}")
        return
    finally:
        # Release lock
        try:
            db.client.rpc('release_stock_lock', {'lock_id': lock_id}).execute()
            logger.info(f"Thread {thread_id}: ✓ Lock released for {username}")
        except Exception as e:
            logger.error(f"Thread {thread_id}: Failed to release lock: {e}")


def test_concurrent_same_user():
    """Test that concurrent recalculations for SAME user are serialized"""
    logger.info("\n" + "="*80)
    logger.info("TEST 1: Concurrent recalculations for SAME user (should be serialized)")
    logger.info("="*80 + "\n")
    
    threads = []
    for i in range(3):
        t = threading.Thread(target=test_advisory_lock, args=("testuser", i))
        threads.append(t)
        t.start()
        time.sleep(0.1)  # Stagger starts slightly
    
    for t in threads:
        t.join()
    
    logger.info("\n✅ TEST 1 COMPLETE: Check logs above - threads should have waited for each other\n")


def test_concurrent_different_users():
    """Test that concurrent recalculations for DIFFERENT users run in parallel"""
    logger.info("\n" + "="*80)
    logger.info("TEST 2: Concurrent recalculations for DIFFERENT users (should run in parallel)")
    logger.info("="*80 + "\n")
    
    threads = []
    for i in range(3):
        username = f"user{i}"
        t = threading.Thread(target=test_advisory_lock, args=(username, i))
        threads.append(t)
        t.start()
    
    for t in threads:
        t.join()
    
    logger.info("\n✅ TEST 2 COMPLETE: Check logs above - threads should have run simultaneously\n")


if __name__ == "__main__":
    logger.info("Starting advisory lock tests...\n")
    
    # Test 1: Same user (should serialize)
    test_concurrent_same_user()
    
    time.sleep(1)
    
    # Test 2: Different users (should parallelize)
    test_concurrent_different_users()
    
    logger.info("\n" + "="*80)
    logger.info("ALL TESTS COMPLETE")
    logger.info("="*80)
