using System.ComponentModel;

namespace UniDipVeri.Domain.Enums;

public enum DegreeLevel
{
    [Description("Bachelor")]
    BACHELOR,
    [Description("Master")]
    MASTER,
    [Description("Doctor,PhD")]
    DOCTORATE,
    [Description("Associate")]
    ASSOCIATE
}
