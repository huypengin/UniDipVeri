using UniDipVeri.Domain.Enums;

namespace UniDipVeri.Domain.Entities;

public class StaffRoleAssignment
{
    public Guid StaffId { get; private set; }
    public StaffRole Role { get; private set; }

    public UniversityStaff? Staff { get; private set; }

    protected StaffRoleAssignment() { }

    public StaffRoleAssignment(Guid staffId, StaffRole role)
    {
        if (staffId == Guid.Empty)
        {
            throw new ArgumentException("StaffId cannot be empty.", nameof(staffId));
        }

        StaffId = staffId;
        Role = role;
    }
}
