use anchor_lang::prelude::*;

declare_id!("BMP23Y1u4FdGSwknSH7PVswT9ru7f9YsyjqR18pHGmBJ"); //mainnet

#[program]
pub mod program_bitmap {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>, len: u64) -> Result<()> {
        let ob = &mut ctx.accounts.ob;
        ob.owner = *ctx.accounts.owner.to_account_info().key;
        ob.bitmap = vec![0u8; len as usize / 8];
        Ok(())
    }

    pub fn set(ctx: Context<Admin>, index: u64) -> Result<()> {
        let ob = &mut ctx.accounts.ob;
        ob.set(index)
    }

    pub fn close(_ctx: Context<Close>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(zero)]
    pub ob: Account<'info, OwnedBitmap>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Admin<'info> {
    #[account(mut, has_one = owner)]
    pub ob: Account<'info, OwnedBitmap>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Close<'info> {
    #[account(mut, close = sol_dest, has_one = owner)]
    pub ob: Account<'info, OwnedBitmap>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
    #[account(mut)]
    sol_dest: AccountInfo<'info>,
}

#[account]
pub struct OwnedBitmap {
    owner: Pubkey,
    bitmap: Vec<u8>,
}

#[error]
pub enum ErrorCode {
    #[msg("value in index already set")]
    AlreadySet, //300 0x12c
    #[msg("index overflow")]
    IndexOverflow, //301 0x12d
}

impl OwnedBitmap {
    fn set(&mut self, index: u64) -> Result<()> {
        if index >= self.capacity() {
            return Err(ErrorCode::IndexOverflow.into());
        }
        let (vec_index, bit_index) = (index / 8, index % 8);
        if self.is_set(index) {
            return Err(ErrorCode::AlreadySet.into());
        }
        self.bitmap[vec_index as usize] |= 1 << bit_index;
        Ok(())
    }

    pub fn capacity(&self) -> u64 {
        (self.bitmap.len() as u64).checked_mul(8).unwrap()
    }

    pub fn is_set(&self, index: u64) -> bool {
        let (vec_index, bit_index) = (index / 8, index % 8);
        self.bitmap[vec_index as usize] >> bit_index & 1 == 1
    }
}

#[cfg(test)]
mod tests {
    use anchor_lang::prelude::Pubkey;

    fn bm_count_true(bm: &[u8]) -> u64 {
        let mut count = 0u64;
        bm.iter().for_each(|f| {
            for i in 0..8 {
                if f >> i & 1 == 1 {
                    count += 1;
                }
            }
        });
        count
    }

    fn bm_get(bm: &[u8], index: u64) -> bool {
        let (vec_index, bit_index) = (index / 8, index % 8);
        bm[vec_index as usize] >> bit_index & 1 == 1
    }

    #[test]
    pub fn test_bitmap() {
        let vec_len = 5;
        let capacity = vec_len * 8;
        let mut bm = crate::OwnedBitmap {
            owner: Pubkey::new_unique(),
            bitmap: vec![0u8; vec_len],
        };

        assert_eq!(
            bm.set(capacity as u64).unwrap_err().to_string(),
            crate::ErrorCode::IndexOverflow.to_string(),
            "index overflow"
        );

        for i in 0..capacity {
            let index = i as u64;
            let mut ret = bm.set(index);
            assert!(ret.is_ok());
            assert!(bm_get(&bm.bitmap, index), "should be true");
            assert_eq!(bm_count_true(&bm.bitmap), index + 1);

            ret = bm.set(index);
            assert!(ret.is_err());
            assert_eq!(
                ret.unwrap_err().to_string(),
                crate::ErrorCode::AlreadySet.to_string()
            );
        }
    }
}
